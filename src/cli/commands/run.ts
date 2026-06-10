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
import * as path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolveUserPath } from "../paths.js";
import { writeProcessMetadata, updateProcessMetadata } from "../../artifacts/run-control.js";

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
  const maxAgentCalls = rawOptions.maxAgentCalls !== undefined
    ? parsePositiveInteger(rawOptions.maxAgentCalls, "--max-agent-calls")
    : undefined;
  const maxObservedTokens = rawOptions.maxObservedTokens !== undefined
    ? parsePositiveInteger(rawOptions.maxObservedTokens, "--max-observed-tokens")
    : undefined;
  const maxRunMs = rawOptions.maxRunMs !== undefined
    ? parsePositiveInteger(rawOptions.maxRunMs, "--max-run-ms")
    : undefined;
  const reportMode = rawOptions.report !== undefined
    ? parseReportMode(rawOptions.report)
    : undefined;

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
  if (maxAgentCalls !== undefined) cliOverrides.maxAgentCalls = maxAgentCalls;
  if (maxObservedTokens !== undefined) cliOverrides.maxObservedTokens = maxObservedTokens;
  if (maxRunMs !== undefined) cliOverrides.maxRunMs = maxRunMs;
  if (reportMode !== undefined) cliOverrides.report = reportMode;
  if (rawOptions.verbose !== undefined) cliOverrides.verbose = !!rawOptions.verbose;

  // Load config
  const config = rawOptions.resolvedConfig ? {
    ...rawOptions.resolvedConfig,
    ...(reportMode !== undefined || rawOptions.verbose !== undefined ? {
      reporting: {
        ...rawOptions.resolvedConfig.reporting,
        ...(reportMode !== undefined ? { mode: reportMode } : {}),
        ...(rawOptions.verbose !== undefined ? { verbose: !!rawOptions.verbose } : {})
      }
    } : {}),
    ...(rawOptions.failFast !== undefined ? { failFast: !!rawOptions.failFast } : {})
  } : await loadConfig({
    cwd,
    configPath: rawOptions.config,
    outDir: rawOptions.out,
    cli: cliOverrides
  });

  // Load workflow
  const loaded = await loadWorkflow(workflowPath, config.cwd);

  // Parse workflow
  const parsed = parseWorkflow(loaded);

  // Validate restrictions
  const issues = validateWorkflow(parsed, {
    allowImports: false,
    allowShell: false
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

  const runIdGenerated = rawOptions.runId || crypto.randomUUID();
  const runOutDir = path.join(config.outDir, runIdGenerated);

  if (rawOptions.background && !rawOptions.backgroundWorker) {
    const pid = await launchBackgroundWorker({
      runId: runIdGenerated,
      runOutDir,
      workflowPath: loaded.sourcePath,
      workflowSource: loaded.sourceText || "",
      workflowHash: parsed.sourceHash,
      config,
      rawOptions,
      cwd
    });
    if (config.reporting.mode === "json") {
      process.stdout.write(JSON.stringify({ runId: runIdGenerated, pid, artifactsDir: runOutDir }, null, 2) + "\n");
    } else {
      process.stdout.write(`Started background run ${runIdGenerated}\nPID: ${pid}\nArtifacts: ${runOutDir}\n`);
    }
    return;
  }

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

  await writeProcessMetadata(runOutDir, {
    schemaVersion: "openflow.process.v1",
    runId: runIdGenerated,
    pid: process.pid,
    mode: rawOptions.backgroundWorker ? "background" : "foreground",
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    command: process.argv,
    status: "running"
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
  const signalHandler = (signal: string) => {
    abortController.abort(`${signal} received`);
  };
  const sigIntHandler = () => signalHandler("SIGINT");
  const sigTermHandler = () => signalHandler("SIGTERM");
  process.on("SIGINT", sigIntHandler);
  process.on("SIGTERM", sigTermHandler);

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
        maxAgentCalls,
        maxObservedTokens,
        maxRunMs,
        dryRun: false,
        failFast: !!rawOptions.failFast,
        verbose: config.reporting.verbose,
        resume: rawOptions.resume,
        noCache: rawOptions.noCache === true || rawOptions.cache === false,
        pauseResponses: rawOptions.pauseResponses
      },
      signal: abortController.signal
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

    await updateProcessMetadata(runOutDir, {
      status: result.status,
      exitCode: result.status === "succeeded" ? 0 : result.status === "pending" ? 9 : 1
    });

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
    } else if (result.status === "pending") {
      const pauseId = result.pendingPause?.id ?? "pause";
      throw new OpenFlowError(ErrorCode.WORKFLOW_PENDING, `Workflow is pending at pause '${pauseId}'.`);
    }
  } finally {
    process.off("SIGINT", sigIntHandler);
    process.off("SIGTERM", sigTermHandler);
  }
}

async function launchBackgroundWorker(input: {
  runId: string;
  runOutDir: string;
  workflowPath: string;
  workflowSource: string;
  workflowHash: string;
  config: any;
  rawOptions: any;
  cwd: string;
}): Promise<number> {
  const artifactStore = new FileSystemArtifactStore({ rootDir: input.config.outDir });
  await artifactStore.createRun({
    runId: input.runId,
    outDir: input.runOutDir,
    workflowPath: input.workflowPath,
    workflowSource: input.workflowSource,
    workflowHash: input.workflowHash,
    resolvedConfig: input.config,
    openflowVersion: "0.0.0",
    cwd: input.cwd,
    configPath: input.rawOptions.config
  });

  const args = buildBackgroundWorkerArgs(input);
  await writeProcessMetadata(input.runOutDir, {
    schemaVersion: "openflow.process.v1",
    runId: input.runId,
    pid: -1,
    mode: "background",
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    command: [process.execPath, ...args],
    status: "starting"
  });

  const child = spawn(process.execPath, args, {
    cwd: input.cwd,
    detached: true,
    stdio: "ignore"
  });
  child.unref();

  await updateProcessMetadata(input.runOutDir, {
    pid: child.pid ?? -1,
    command: [process.execPath, ...args]
  });
  return child.pid ?? -1;
}

function buildBackgroundWorkerArgs(input: {
  runId: string;
  workflowPath: string;
  config: any;
  rawOptions: any;
  cwd: string;
}): string[] {
  const cliEntry = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../index.js");
  const raw = input.rawOptions;
  const args = [
    cliEntry,
    "run",
    input.workflowPath,
    "--cwd",
    input.config.cwd,
    "--out",
    input.config.outDir,
    "--background-worker",
    "--run-id",
    input.runId
  ];
  if (raw.config) args.push("--config", resolveUserPath(raw.config, input.cwd));
  if (raw.provider) args.push("--provider", raw.provider);
  if (raw.model) args.push("--model", raw.model);
  for (const arg of raw.arg || []) args.push("--arg", arg);
  if (raw.report) args.push("--report", raw.report);
  if (raw.concurrency) args.push("--concurrency", String(raw.concurrency));
  if (raw.timeoutMs) args.push("--timeout-ms", String(raw.timeoutMs));
  if (raw.maxAgentCalls) args.push("--max-agent-calls", String(raw.maxAgentCalls));
  if (raw.maxObservedTokens) args.push("--max-observed-tokens", String(raw.maxObservedTokens));
  if (raw.maxRunMs) args.push("--max-run-ms", String(raw.maxRunMs));
  if (raw.resume) args.push("--resume", raw.resume);
  if (raw.noCache || raw.cache === false) args.push("--no-cache");
  if (raw.failFast) args.push("--fail-fast");
  if (raw.verbose) args.push("--verbose");
  return args;
}
