import { ErrorCode } from "../../errors/codes.js";
import { OpenDynamicWorkflowError } from "../../errors/types.js";
import { loadConfig } from "../../config/load.js";
import { discoverWorkflowRegistry } from "../../workflow/discovery.js";
import { resolveWorkflowTarget } from "../../workflow/resolve-target.js";
import { parseKeyValueArgs, parsePositiveInteger, parseReportMode, parseThinkingEffort } from "../args.js";
import { printDryRunSummary } from "../print.js";
import { DefaultRuntimeRunner, type RuntimeRunner } from "../../runtime/public.js";
import { FileSystemArtifactStore } from "../../artifacts/run-store.js";
import { DefaultAgentExecutor } from "../../agents/execute-agent.js";
import { createReporter } from "../../output/reporter.js";
import { EventBus } from "../../orchestration/event-bus.js";
import { loadSharedAgentRegistry } from "../../shared-agents/load.js";
import { loadToolRegistry } from "../../tools/load.js";
import { DefaultToolExecutor } from "../../tools/executor.js";
import * as path from "node:path";
import { detectProjectInitHintContext, attachHintToError } from "../../errors/project-init-hint.js";

export interface RunCommandDeps {
  runtimeRunner: RuntimeRunner;
  stdout?: NodeJS.WritableStream;
  stderr?: NodeJS.WritableStream;
}

export interface RunCommandInput {
  workflowFile: string;
  rawOptions: any;
  deps?: Partial<RunCommandDeps>;
}

export interface RunWorkflowServiceInput {
  workflowFile: string;
  rawOptions?: any;
  deps?: Partial<RunCommandDeps>;
}

export async function runWorkflowService(
  input: RunWorkflowServiceInput
): Promise<void> {
  const rawOptions = input.rawOptions || {};
  const cwd = rawOptions.cwd ?? process.cwd();

  // Parse option arguments cleanly
  const parsedArgs = parseKeyValueArgs(rawOptions.arg || []);
  const concurrency = rawOptions.concurrency !== undefined
    ? parsePositiveInteger(rawOptions.concurrency, "--concurrency")
    : undefined;
  const timeoutMs = rawOptions.timeoutMs !== undefined
    ? parsePositiveInteger(rawOptions.timeoutMs, "--timeout-ms")
    : undefined;
  const maxAgentCalls = rawOptions.maxAgentCalls !== undefined
    ? parsePositiveInteger(rawOptions.maxAgentCalls, "--max-agent-calls")
    : undefined;
  const reportMode = rawOptions.report !== undefined
    ? parseReportMode(rawOptions.report)
    : undefined;
  const noCache = rawOptions.cache === false || rawOptions.noCache === true;

  if (rawOptions.resume !== undefined && (typeof rawOptions.resume !== "string" || rawOptions.resume.trim() === "")) {
    throw new OpenDynamicWorkflowError(
      ErrorCode.CLI_USAGE_ERROR,
      "CLI option '--resume' value must be a non-empty string."
    );
  }

  if (rawOptions.model !== undefined && (typeof rawOptions.model !== "string" || rawOptions.model.trim() === "")) {
    throw new OpenDynamicWorkflowError(
      ErrorCode.CLI_USAGE_ERROR,
      "CLI option '--model' value must be a non-empty string."
    );
  }

  const thinkingEffort = rawOptions.thinkingEffort !== undefined
    ? parseThinkingEffort(rawOptions.thinkingEffort)
    : undefined;


  const cliOverrides: any = {};
  if (rawOptions.provider !== undefined) cliOverrides.provider = rawOptions.provider;
  if (rawOptions.model !== undefined) cliOverrides.model = rawOptions.model;
  if (concurrency !== undefined) cliOverrides.concurrency = concurrency;
  if (timeoutMs !== undefined) cliOverrides.timeoutMs = timeoutMs;
  if (maxAgentCalls !== undefined) cliOverrides.maxAgentCalls = maxAgentCalls;
  if (reportMode !== undefined) cliOverrides.report = reportMode;
  if (rawOptions.verbose !== undefined) cliOverrides.verbose = !!rawOptions.verbose;

  // Load config
  const config = await loadConfig({
    cwd,
    configPath: rawOptions.config,
    outDir: rawOptions.out,
    cli: cliOverrides
  });

  // Resolve workflow target
  const resolved = await resolveWorkflowTarget({
    target: input.workflowFile,
    cwd: config.cwd,
    config,
    mode: "run"
  });

  // During resume, preserve original target metadata if provided
  if (rawOptions.originalRequestedTarget) {
    resolved.requestedTarget = rawOptions.originalRequestedTarget;
  }
  if (rawOptions.originalTargetKind) {
    resolved.targetKind = rawOptions.originalTargetKind;
  }
  if (rawOptions.originalWorkflowName) {
    resolved.workflowName = rawOptions.originalWorkflowName;
  }

  // Load shared agent registry
  const sharedAgentRegistry = await loadSharedAgentRegistry({
    cwd: config.cwd,
    dir: config.sharedAgents?.dir,
    maxDefinitions: config.sharedAgents?.maxDefinitions,
    strictPromptTemplateVariables: config.sharedAgents?.strictPromptTemplateVariables
  });

  // Load tool registry
  const toolRegistry = await loadToolRegistry({
    cwd: config.cwd,
    dir: config.tools?.dir,
    maxDefinitions: config.tools?.maxDefinitions ?? 100
  });

  // Discover and validate workflow registry
  const workflowRegistry = await discoverWorkflowRegistry({
    rootWorkflowPath: resolved.workflowFile,
    cwd: config.cwd,
    include: config.workflow.discovery.include,
    candidatePaths: resolved.candidatePaths,
    sharedAgentRegistry,
    toolRegistry,
    allowDynamicSharedAgentIds: config.sharedAgents?.allowDynamicIds,
    maxLoopRounds: config.workflow.maxLoopRounds
  });

  // Retrieve root workflow
  const absoluteRootPath = path.resolve(config.cwd, resolved.workflowFile);
  const rootDefinition = workflowRegistry.list().find(d => d.sourcePath === absoluteRootPath);
  if (!rootDefinition) {
    throw new OpenDynamicWorkflowError(
      ErrorCode.WORKFLOW_DEFINITION_NOT_FOUND,
      `Root workflow definition not found in discovery: ${absoluteRootPath}`
    );
  }
  const parsed = rootDefinition.parsedWorkflow;

  // Dry run check
  if (rawOptions.dryRun) {
    printDryRunSummary({
      workflowFile: resolved.workflowFileRelative,
      workflowName: resolved.workflowName,
      description: parsed.meta.description,
      phases: parsed.meta.phases || [],
      provider: config.defaultProvider,
      defaultModel: config.defaultModel,
      providers: config.providers,
      concurrency: config.concurrency,
      timeoutMs: config.timeoutMs,
      reportMode: config.reporting.mode,
      outDir: config.outDir,
      verbose: config.reporting.verbose
    });
    return;
  }

  const runIdGenerated = crypto.randomUUID();
  const runOutDir = path.join(config.outDir, runIdGenerated);
  const artifactStore = new FileSystemArtifactStore({ rootDir: config.outDir });

  // Initialize abort controller early for tools and agents
  const abortController = new AbortController();
  const sigIntHandler = () => {
    abortController.abort("SIGINT received");
  };
  process.on("SIGINT", sigIntHandler);

  const workflowIdentity = {
    name: rawOptions.originalWorkflowName || resolved.workflowName,
    file: resolved.workflowFileRelative,
    requestedTarget: rawOptions.originalRequestedTarget || resolved.requestedTarget,
    targetKind: rawOptions.originalTargetKind || resolved.targetKind
  };

  const runtimeWorkflowIdentity = {
    name: workflowIdentity.name,
    file: workflowIdentity.file,
    requestedTarget: workflowIdentity.requestedTarget,
    targetKind: workflowIdentity.targetKind,
    workflowFile: resolved.workflowFile,
    workflowFileRelative: resolved.workflowFileRelative,
    discoverySource: resolved.discoverySource
  };

  // Initialize artifact store before running so it's ready regardless of which runner is used.
  await artifactStore.createRun({
    runId: runIdGenerated,
    outDir: runOutDir,
    workflowPath: resolved.workflowFile,
    workflowSource: rootDefinition.parsedWorkflow.sourceText || "",
    workflowHash: parsed.sourceHash,
    workflow: workflowIdentity,
    resolvedConfig: config,
    openDynamicWorkflowVersion: parsed.meta.version || "0.0.0",
    cwd,
    configPath: rawOptions.config
  });
  await artifactStore.writeJson("run-input.json", {
    schemaVersion: "open-dynamic-workflow.run-input.v1",
    runId: runIdGenerated,
    workflowFile: resolved.workflowFile,
    requestedTarget: resolved.requestedTarget,
    targetKind: resolved.targetKind,
    workflowName: resolved.workflowName,
    cwd: config.cwd,
    outDir: config.outDir,
    configPath: config.configPath,
    rawOptions: {
      provider: rawOptions.provider,
      model: rawOptions.model,
      arg: rawOptions.arg || [],
      config: config.configPath,
      cwd: config.cwd,
      out: config.outDir,
      report: rawOptions.report,
      concurrency: rawOptions.concurrency,
      timeoutMs: rawOptions.timeoutMs,
      maxAgentCalls: rawOptions.maxAgentCalls,
      resume: rawOptions.resume,
      noCache: noCache,
      failFast: !!rawOptions.failFast,
      verbose: !!rawOptions.verbose,
      thinkingEffort: rawOptions.thinkingEffort
    }
  });

  const reporter = createReporter({
    mode: config.reporting.mode,
    verbose: config.reporting.verbose,
    streams: {
      stdout: input.deps?.stdout ?? process.stdout,
      stderr: input.deps?.stderr ?? process.stderr
    }
  });

  const eventBus = new EventBus({
    runId: runIdGenerated,
    artifactStore,
    subscribers: [
      {
        handle(event) {
          reporter.handle(event);
        }
      }
    ]
  });

  // Note: workflow.resolved is now emitted inside the runtime runner execution boundary.

  const agentExecutor = new DefaultAgentExecutor({
    config: config as any,
    artifactStore,
    eventBus
  });

  // Collect secrets for tool redaction
  const secretPatterns = config.security?.redactEnv ?? [];
  const secretValues: string[] = [];
  for (const [key, value] of Object.entries(process.env)) {
    if (value && typeof value === "string") {
      const { shouldRedactEnvName } = await import("../../security/env.js");
      if (shouldRedactEnvName(key, secretPatterns)) {
        secretValues.push(value);
      }
    }
  }

  const toolExecutor = new DefaultToolExecutor({
    concurrency: config.tools?.concurrency ?? 1,
    eventSink: eventBus,
    artifactStore,
    runArtifacts: artifactStore.getRunArtifacts(),
    runId: runIdGenerated,
    cwd: config.cwd,
    rootSignal: abortController.signal,
    redactedSecrets: secretValues
  });

  reporter.start({
    runId: runIdGenerated,
    meta: parsed.meta,
    workflow: workflowIdentity,
    artifactsDir: runOutDir
  });

  const defaultRunner = new DefaultRuntimeRunner();
  const runner = input.deps?.runtimeRunner ?? defaultRunner;

  try {
    const result = await runner.run({
      parsedWorkflow: parsed,
      workflowRegistry,
      workflowIdentity: runtimeWorkflowIdentity,
      config: config as any,
      cli: {
        workflowFile: rootDefinition.sourcePath,
        provider: rawOptions.provider,
        model: rawOptions.model,
        args: parsedArgs,
        cwd: config.cwd,
        outDir: runOutDir,
        report: config.reporting.mode,
        concurrency: config.concurrency,
        timeoutMs: config.timeoutMs,
        maxAgentCalls: config.maxAgentCalls,
        resume: rawOptions.resume,
        noCache,
        dryRun: false,
        failFast: !!rawOptions.failFast,
        verbose: config.reporting.verbose,
        thinkingEffort
      },
      signal: abortController.signal,
      sharedAgentRegistry,
      toolRegistry
    }, (() => {
      let pipelineCounter = 0;
      return {
        agentExecutor,
        eventSink: eventBus,
        artifactStore,
        toolExecutor,
        idGenerator: {
          nextId: (prefix: string) => {
            if (prefix === "run") return runIdGenerated;
            if (prefix === "pipeline") {
              pipelineCounter += 1;
              return `pipeline-${pipelineCounter}`;
            }
            return crypto.randomUUID();
          }
        }
      };
    })());

    await eventBus.drain();

    // Attach workflow identity to result
    result.workflow = workflowIdentity;

    if (artifactStore.isRunCreated()) {
      await artifactStore.writeFinalReport(result);
    }
    await reporter.finish(result);

    if (result.status === "failed") {
      const agents = result.agents || [];
      const hasTimeout = agents.some((a) => a.status === "timed_out");
      
      let errorCode: ErrorCode = hasTimeout ? ErrorCode.PROCESS_TIMEOUT : ErrorCode.PROVIDER_PROCESS_FAILED;
      
      // Preserve specific error code if present
      if (result.error && typeof result.error === "object" && result.error.code) {
        if (Object.values(ErrorCode).includes(result.error.code as any)) {
          errorCode = result.error.code as ErrorCode;
        }
      }
      
      const errMessage = typeof result.error === "string"
        ? result.error
        : (result.error as any)?.message || "Workflow run failed";
      throw new OpenDynamicWorkflowError(errorCode, errMessage, { cause: result.error });
    } else if (result.status === "cancelled") {
      throw new OpenDynamicWorkflowError(ErrorCode.USER_CANCELLED, "Workflow run was cancelled");
    }
  } finally {
    process.off("SIGINT", sigIntHandler);
  }
}

export async function runCommand(input: RunCommandInput): Promise<void> {
  const rawOptions = input.rawOptions || {};
  const cwd = rawOptions.cwd ?? process.cwd();
  const resolvedCwd = path.resolve(cwd);
  const hintContext = detectProjectInitHintContext({
    cwd: resolvedCwd,
    configPath: rawOptions.config,
    invokedBinaryName: rawOptions.__invokedBinaryName,
  });

  try {
    await runWorkflowService(input);
  } catch (error) {
    throw attachHintToError(error, hintContext);
  }
}

