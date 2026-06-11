import { ErrorCode } from "../../errors/codes.js";
import { OpenFlowError } from "../../errors/types.js";
import { loadConfig } from "../../config/load.js";
import { loadWorkflow } from "../../workflow/load.js";
import { parseWorkflow } from "../../workflow/parse.js";
import { validateWorkflow } from "../../workflow/validate.js";
import { parseKeyValueArgs, parsePositiveInteger, parseReportMode } from "../args.js";
import { printDryRunSummary } from "../print.js";
import { DefaultRuntimeRunner, type RuntimeRunner, type WorkflowRunResult } from "../../runtime/public.js";
import { FileSystemArtifactStore } from "../../artifacts/run-store.js";
import { createDefaultProviderRegistry } from "../../agents/registry.js";
import { DefaultAgentExecutor } from "../../agents/execute-agent.js";
import { createReporter } from "../../output/reporter.js";
import { EventBus } from "../../orchestration/event-bus.js";
import { loadSharedAgentRegistry } from "../../shared-agents/load.js";
import * as path from "node:path";
import { resolveUserPath } from "../paths.js";

export interface RunCommandDeps {
  runtimeRunner: RuntimeRunner;
}

export interface RunCommandInput {
  workflowFile: string;
  rawOptions: any;
  deps?: Partial<RunCommandDeps>;
}

const defaultRuntimeRunner: RuntimeRunner = {
  async run(input): Promise<WorkflowRunResult> {
    const timeStr = new Date().toISOString();
    return {
      schemaVersion: "openflow.report.v1",
      runId: "stub-run-id",
      status: "succeeded",
      durationMs: 0,
      artifactsDir: input.config.outDir,
      meta: input.parsedWorkflow.meta,
      agents: [],
      startedAt: timeStr,
      finishedAt: timeStr,
      reportPath: path.join(input.config.outDir, "report.json"),
      eventsPath: path.join(input.config.outDir, "events.jsonl")
    };
  }
};

export async function runCommand(input: RunCommandInput): Promise<void> {
  const rawOptions = input.rawOptions || {};
  const cwd = rawOptions.cwd ?? process.cwd();

  const workflowPath = resolveUserPath(input.workflowFile, cwd);

  // Parse option arguments cleanly
  const parsedArgs = parseKeyValueArgs(rawOptions.arg || []);
  const concurrency = rawOptions.concurrency !== undefined
    ? parsePositiveInteger(rawOptions.concurrency, "--concurrency")
    : undefined;
  const timeoutMs = rawOptions.timeoutMs !== undefined
    ? parsePositiveInteger(rawOptions.timeoutMs, "--timeout-ms")
    : undefined;
  const reportMode = rawOptions.report !== undefined
    ? parseReportMode(rawOptions.report)
    : undefined;
  const noCache = rawOptions.cache === false || rawOptions.noCache === true;

  if (rawOptions.resume !== undefined && (typeof rawOptions.resume !== "string" || rawOptions.resume.trim() === "")) {
    throw new OpenFlowError(
      ErrorCode.CLI_USAGE_ERROR,
      "CLI option '--resume' value must be a non-empty string."
    );
  }

  if (rawOptions.model !== undefined && (typeof rawOptions.model !== "string" || rawOptions.model.trim() === "")) {
    throw new OpenFlowError(
      ErrorCode.CLI_USAGE_ERROR,
      "CLI option '--model' value must be a non-empty string."
    );
  }

  const cliOverrides: any = {};
  if (rawOptions.provider !== undefined) cliOverrides.provider = rawOptions.provider;
  if (rawOptions.model !== undefined) cliOverrides.model = rawOptions.model;
  if (concurrency !== undefined) cliOverrides.concurrency = concurrency;
  if (timeoutMs !== undefined) cliOverrides.timeoutMs = timeoutMs;
  if (reportMode !== undefined) cliOverrides.report = reportMode;
  if (rawOptions.verbose !== undefined) cliOverrides.verbose = !!rawOptions.verbose;

  // Load config
  const config = await loadConfig({
    cwd,
    configPath: rawOptions.config,
    outDir: rawOptions.out,
    cli: cliOverrides
  });

  // Load workflow
  const loaded = await loadWorkflow(workflowPath, config.cwd);

  // Parse workflow
  const parsed = parseWorkflow(loaded);

  // Load shared agent registry
  const registry = await loadSharedAgentRegistry({
    cwd: config.cwd,
    dir: config.sharedAgents?.dir,
    maxDefinitions: config.sharedAgents?.maxDefinitions,
    strictPromptTemplateVariables: config.sharedAgents?.strictPromptTemplateVariables
  });

  // Validate restrictions
  const issues = validateWorkflow(parsed, {
    allowImports: false,
    allowShell: false,
    allowDynamicSharedAgentIds: config.sharedAgents?.allowDynamicIds,
    knownSharedAgentIds: new Set(registry.list().map(entry => entry.id)),
    sharedAgentRegistry: registry
  });

  if (issues.length > 0) {
    const summary = issues.map((issue) => issue.message).join("\n");
    throw new OpenFlowError(
      ErrorCode.WORKFLOW_VALIDATION_ERROR,
      `Workflow validation failed:\n${summary}`
    );
  }

  // Dry run check
  if (rawOptions.dryRun) {
    printDryRunSummary({
      workflowFile: loaded.sourcePath,
      workflowName: parsed.meta.name,
      description: parsed.meta.description,
      phases: parsed.meta.phases || [],
      provider: config.defaultProvider,
      defaultModel: config.defaultModel,
      providers: config.providers,
      concurrency: config.concurrency,
      timeoutMs: config.timeoutMs,
      reportMode: config.reporting.mode,
      outDir: config.outDir
    });
    return;
  }

  const runIdGenerated = crypto.randomUUID();
  const runOutDir = path.join(config.outDir, runIdGenerated);
  const artifactStore = new FileSystemArtifactStore({ rootDir: config.outDir });

  // Initialize artifact store before running so it's ready regardless of which runner is used.
  await artifactStore.createRun({
    runId: runIdGenerated,
    outDir: runOutDir,
    workflowPath: loaded.sourcePath,
    workflowSource: loaded.sourceText || "",
    workflowHash: parsed.sourceHash,
    resolvedConfig: config,
    openflowVersion: parsed.meta.version || "0.0.0",
    cwd,
    configPath: rawOptions.config
  });
  await artifactStore.writeJson("run-input.json", {
    schemaVersion: "openflow.run-input.v1",
    runId: runIdGenerated,
    workflowFile: loaded.sourcePath,
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
      failFast: !!rawOptions.failFast,
      verbose: !!rawOptions.verbose
    }
  });

  const reporter = createReporter({
    mode: config.reporting.mode,
    verbose: config.reporting.verbose
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

  const agentExecutor = new DefaultAgentExecutor({
    config: config as any,
    artifactStore,
    eventBus
  });

  reporter.start({
    runId: runIdGenerated,
    meta: parsed.meta,
    artifactsDir: runOutDir
  });

  const defaultRunner = new DefaultRuntimeRunner();
  const runner = input.deps?.runtimeRunner ?? defaultRunner;

  const abortController = new AbortController();
  const sigIntHandler = () => {
    abortController.abort("SIGINT received");
  };
  process.on("SIGINT", sigIntHandler);

  try {
    const result = await runner.run({
      parsedWorkflow: parsed,
      config: config as any,
      cli: {
        workflowFile: loaded.sourcePath,
        provider: rawOptions.provider,
        model: rawOptions.model,
        args: parsedArgs,
        cwd: config.cwd,
        outDir: runOutDir,
        report: config.reporting.mode,
        concurrency: config.concurrency,
        timeoutMs: config.timeoutMs,
        resume: rawOptions.resume,
        noCache,
        dryRun: false,
        failFast: !!rawOptions.failFast,
        verbose: config.reporting.verbose
      },
      signal: abortController.signal,
      sharedAgentRegistry: registry
    }, (() => {
      let pipelineCounter = 0;
      return {
        agentExecutor,
        eventSink: eventBus,
        artifactStore,
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
      throw new OpenFlowError(errorCode, errMessage, { cause: result.error });
    } else if (result.status === "cancelled") {
      throw new OpenFlowError(ErrorCode.USER_CANCELLED, "Workflow run was cancelled");
    }
  } finally {
    process.off("SIGINT", sigIntHandler);
  }
}
