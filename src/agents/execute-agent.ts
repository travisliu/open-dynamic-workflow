import type { AgentExecutor, AgentExecutionInput } from "./execution-types.js";
import type { AgentResult, AgentSuccessResult, AgentFailureResult, AgentRunInput, AgentPermissions } from "../types/agent.js";
import type { ResolvedConfig } from "../types/config.js";
import type { ArtifactStore, AgentArtifacts } from "../types/artifacts.js";
import { EventBus } from "../orchestration/event-bus.js";
import { createDefaultProviderRegistry } from "./registry.js";
import { runProcess } from "./process-runner.js";
import { validateJson } from "../structured/validate-json.js";
import { normalizeAgentOutput } from "../structured/normalize-agent-output.js";
import { buildProviderEnv, shouldRedactEnvName, redactText, StreamRedactor } from "../security/env.js";

const MAX_IN_MEMORY_LOG_SIZE = 1024 * 1024; // 1MB limit for in-memory results

interface MockAdapterWithLookup {
  lookupResponse(input: AgentRunInput): any;
  buildCommand(input: AgentRunInput): Promise<any>;
}

function isMockAdapter(adapter: any): adapter is MockAdapterWithLookup {
  return typeof adapter.lookupResponse === "function";
}

export class DefaultAgentExecutor implements AgentExecutor {
  private readonly config: ResolvedConfig;
  private readonly artifactStore: ArtifactStore;
  private readonly eventBus: EventBus;

  constructor(deps: {
    config: ResolvedConfig;
    artifactStore: ArtifactStore;
    eventBus: EventBus;
  }) {
    this.config = deps.config;
    this.artifactStore = deps.artifactStore;
    this.eventBus = deps.eventBus;
  }

  async execute(input: AgentExecutionInput): Promise<AgentResult> {
    const registry = createDefaultProviderRegistry({ config: this.config });
    const adapter = registry.get(input.provider);
    const resolvedPerms = input.permissions || { mode: "default" };

    // 1. Write prompt.txt
    await this.artifactStore.writeText(`agents/${input.id}/prompt.txt`, input.prompt);

    // 2. Write schema.json if schema is provided
    if (input.schema) {
      await this.artifactStore.writeJson(`agents/${input.id}/schema.json`, input.schema);
    }

    // Write metadata.json
    const metadataJson = {
      model: input.model,
      resolutionSource: input.metadata?.modelResolutionSource || "provider-default",
      structuredOutputTransport: input.schema ? input.structuredOutput?.transport ?? "auto" : undefined,
      permissions: resolvedPerms
    };
    await this.artifactStore.writeJson(`agents/${input.id}/metadata.json`, metadataJson);

    // Write permissions.json
    await this.artifactStore.writeJson(`agents/${input.id}/permissions.json`, resolvedPerms);

    // Initialize empty log files
    await this.artifactStore.writeText(`agents/${input.id}/stdout.log`, "");
    await this.artifactStore.writeText(`agents/${input.id}/stderr.log`, "");

    const secretPatterns = this.config.security?.redactEnv ?? [];
    const secretValues: string[] = [];
    for (const [key, value] of Object.entries(process.env)) {
      if (value && shouldRedactEnvName(key, secretPatterns)) {
        secretValues.push(value);
      }
    }

    const stdoutRedactor = new StreamRedactor(secretValues);
    const stderrRedactor = new StreamRedactor(secretValues);

    const startMs = Date.now();
    let stdoutInMemory = "";
    let stderrInMemory = "";
    let exitCode: number | null = null;
    let timedOut = false;
    let cancelled = false;

    const agentArtifacts: AgentArtifacts = {
      dir: `agents/${input.id}`,
      promptPath: `agents/${input.id}/prompt.txt`,
      stdoutPath: `agents/${input.id}/stdout.log`,
      stderrPath: `agents/${input.id}/stderr.log`,
      rawResultPath: `agents/${input.id}/raw-result.json`,
      normalizedResultPath: `agents/${input.id}/normalized-result.json`,
      permissionsPath: `agents/${input.id}/permissions.json`,
      metadataPath: `agents/${input.id}/metadata.json`
    };

    if (input.schema) {
      agentArtifacts.schemaPath = `agents/${input.id}/schema.json`;
    }

    // Run input
    const runInput: AgentRunInput = {
      id: input.id,
      label: input.label,
      provider: input.provider,
      prompt: input.prompt,
      model: input.model,
      schema: input.schema,
      structuredOutput: input.structuredOutput,
      timeoutMs: input.timeoutMs,
      cwd: input.cwd,
      env: {},
      permissions: resolvedPerms,
      metadata: input.metadata
    };

    const appendToLogs = async (stream: "stdout" | "stderr", chunk: string, redactor: StreamRedactor) => {
      const redactedPart = redactor.process(chunk);
      if (redactedPart) {
        if (stream === "stdout") {
          if (stdoutInMemory.length < MAX_IN_MEMORY_LOG_SIZE) {
            stdoutInMemory += redactedPart;
          }
        } else {
          if (stderrInMemory.length < MAX_IN_MEMORY_LOG_SIZE) {
            stderrInMemory += redactedPart;
          }
        }
        await this.artifactStore.appendText(`agents/${input.id}/${stream}.log`, redactedPart);
        await this.eventBus.emit("agent.output", { agentId: input.id, stream, data: redactedPart });
      }
    };

    let executionResult: { exitCode: number | null; timedOut: boolean; cancelled: boolean };
    let commandInput: any;
    try {
      if (input.provider === "mock" && isMockAdapter(adapter)) {
        await adapter.buildCommand(runInput);
      } else {
        commandInput = await adapter.buildCommand(runInput);
      }
    } catch (err: any) {
      // Flush redactors
      const finalStdout = stdoutRedactor.flush();
      if (finalStdout) {
        if (stdoutInMemory.length < MAX_IN_MEMORY_LOG_SIZE) stdoutInMemory += finalStdout;
        await this.artifactStore.appendText(`agents/${input.id}/stdout.log`, finalStdout);
        await this.eventBus.emit("agent.output", { agentId: input.id, stream: "stdout", data: finalStdout });
      }
      const finalStderr = stderrRedactor.flush();
      if (finalStderr) {
        if (stderrInMemory.length < MAX_IN_MEMORY_LOG_SIZE) stderrInMemory += finalStderr;
        await this.artifactStore.appendText(`agents/${input.id}/stderr.log`, finalStderr);
        await this.eventBus.emit("agent.output", { agentId: input.id, stream: "stderr", data: finalStderr });
      }

      const durationMs = Date.now() - startMs;
      const errorPayload = {
        name: err?.name || "Error",
        message: err?.message || String(err),
        code: err?.code || "INTERNAL_ERROR"
      } as any;
      if (err?.stack) {
        errorPayload.stack = err.stack;
      }

      const failureResult: AgentFailureResult = {
        ok: false,
        status: "failed",
        id: input.id,
        label: input.label,
        provider: input.provider,
        model: input.model,
        stdout: stdoutInMemory,
        stderr: stderrInMemory,
        exitCode: null,
        durationMs,
        artifacts: agentArtifacts,
        error: errorPayload,
        permissions: resolvedPerms
      };

      await this.artifactStore.writeJson(`agents/${input.id}/raw-result.json`, failureResult);
      return failureResult;
    }

    if (input.provider === "mock" && isMockAdapter(adapter)) {
      executionResult = await this.executeMock(input, runInput, adapter, appendToLogs, { stdoutRedactor, stderrRedactor });
    } else {
      executionResult = await this.executeProcess(input, runInput, commandInput, adapter, appendToLogs, { stdoutRedactor, stderrRedactor });
    }

    exitCode = executionResult.exitCode;
    timedOut = executionResult.timedOut;
    cancelled = executionResult.cancelled;

    // Flush redactors
    const finalStdout = stdoutRedactor.flush();
    if (finalStdout) {
      if (stdoutInMemory.length < MAX_IN_MEMORY_LOG_SIZE) stdoutInMemory += finalStdout;
      await this.artifactStore.appendText(`agents/${input.id}/stdout.log`, finalStdout);
      await this.eventBus.emit("agent.output", { agentId: input.id, stream: "stdout", data: finalStdout });
    }
    const finalStderr = stderrRedactor.flush();
    if (finalStderr) {
      if (stderrInMemory.length < MAX_IN_MEMORY_LOG_SIZE) stderrInMemory += finalStderr;
      await this.artifactStore.appendText(`agents/${input.id}/stderr.log`, finalStderr);
      await this.eventBus.emit("agent.output", { agentId: input.id, stream: "stderr", data: finalStderr });
    }

    const durationMs = Date.now() - startMs;

    // Determine success/failure status based on precedence

    if (timedOut) {
      const errPayload = { name: "TimeoutError", message: "Agent execution timed out", code: "PROCESS_TIMEOUT" };
      const failureResult: AgentFailureResult = {
        ok: false,
        status: "timed_out",
        id: input.id,
        label: input.label,
        provider: input.provider,
        model: input.model,
        stdout: stdoutInMemory,
        stderr: stderrInMemory,
        exitCode: null,
        durationMs,
        artifacts: agentArtifacts,
        error: errPayload,
        permissions: resolvedPerms
      };
      await this.artifactStore.writeJson(`agents/${input.id}/raw-result.json`, failureResult);
      return failureResult;
    }

    if (cancelled) {
      const errPayload = { name: "CancelledError", message: "Agent execution was cancelled", code: "USER_CANCELLED" };
      const failureResult: AgentFailureResult = {
        ok: false,
        status: "cancelled",
        id: input.id,
        label: input.label,
        provider: input.provider,
        model: input.model,
        stdout: stdoutInMemory,
        stderr: stderrInMemory,
        exitCode: null,
        durationMs,
        artifacts: agentArtifacts,
        error: errPayload,
        permissions: resolvedPerms
      };
      await this.artifactStore.writeJson(`agents/${input.id}/raw-result.json`, failureResult);
      return failureResult;
    }

    if (exitCode !== null && exitCode !== 0) {
      const failureResult: AgentFailureResult = {
        ok: false,
        status: "failed",
        id: input.id,
        label: input.label,
        provider: input.provider,
        model: input.model,
        stdout: stdoutInMemory,
        stderr: stderrInMemory,
        exitCode,
        durationMs,
        artifacts: agentArtifacts,
        error: {
          name: "ProviderProcessFailed",
          message: stderrInMemory.trim() || `Process exited with code ${exitCode}`,
          code: "PROVIDER_PROCESS_FAILED"
        },
        permissions: resolvedPerms
      };
      await this.artifactStore.writeJson(`agents/${input.id}/raw-result.json`, failureResult);
      return failureResult;
    }

    let parseResult;
    try {
      parseResult = await adapter.parseResult({
        input: runInput,
        stdout: stdoutInMemory,
        stderr: stderrInMemory,
        exitCode
      });
    } catch (err: any) {
      const failureResult: AgentFailureResult = {
        ok: false,
        status: "failed",
        id: input.id,
        label: input.label,
        provider: input.provider,
        model: input.model,
        stdout: stdoutInMemory,
        stderr: stderrInMemory,
        exitCode,
        durationMs,
        artifacts: agentArtifacts,
        error: {
          name: "ParseError",
          message: `Parser crashed: ${err.message}`,
          code: "INTERNAL_ERROR"
        },
        permissions: resolvedPerms
      };
      await this.artifactStore.writeJson(`agents/${input.id}/raw-result.json`, failureResult);
      return failureResult;
    }

    const rawResult = parseResult.raw ?? parseResult;
    let savedRawResult: any;
    if (rawResult && typeof rawResult === "object" && !Array.isArray(rawResult)) {
      savedRawResult = {
        ...rawResult,
        permissions: resolvedPerms
      };
    } else {
      savedRawResult = {
        raw: rawResult,
        permissions: resolvedPerms
      };
    }
    await this.artifactStore.writeJson(`agents/${input.id}/raw-result.json`, savedRawResult);

    const normalized = await normalizeAgentOutput({
      schema: input.schema,
      parsed: parseResult,
      stdout: stdoutInMemory
    });

    if (!normalized.ok) {
      if (normalized.error.errors) {
        agentArtifacts.validationErrorPath = `agents/${input.id}/validation-error.json`;
        await this.artifactStore.writeJson(`agents/${input.id}/validation-error.json`, normalized.error.errors);
      }

      const failureResult: AgentFailureResult = {
        ok: false,
        status: "failed",
        id: input.id,
        label: input.label,
        provider: input.provider,
        model: input.model,
        stdout: stdoutInMemory,
        stderr: stderrInMemory,
        exitCode,
        durationMs,
        artifacts: agentArtifacts,
        error: {
          name: "ValidationError",
          message: normalized.error.message,
          code: normalized.error.code as any
        },
        permissions: resolvedPerms
      };
      return failureResult;
    }

    await this.artifactStore.writeJson(`agents/${input.id}/normalized-result.json`, normalized.json ?? normalized.text);

    const successResult: AgentSuccessResult = {
      ok: true,
      status: "succeeded",
      id: input.id,
      label: input.label,
      provider: input.provider,
      model: input.model,
      text: redactText(normalized.text ?? "", secretValues),
      json: normalized.json,
      stdout: stdoutInMemory,
      stderr: stderrInMemory,
      exitCode: exitCode ?? 0,
      durationMs,
      artifacts: agentArtifacts,
      permissions: resolvedPerms
    };

    return successResult;
  }

  private async executeMock(
    input: AgentExecutionInput,
    runInput: AgentRunInput,
    adapter: MockAdapterWithLookup,
    appendToLogs: (stream: "stdout" | "stderr", chunk: string, redactor: StreamRedactor) => Promise<void>,
    redactors: { stdoutRedactor: StreamRedactor; stderrRedactor: StreamRedactor }
  ): Promise<{ exitCode: number; timedOut: boolean; cancelled: boolean }> {
    const response = adapter.lookupResponse(runInput);
    let timedOut = false;
    let cancelled = false;

    if (response.delayMs) {
      try {
        await new Promise((resolve, reject) => {
          const timer = setTimeout(resolve, response.delayMs);
          input.signal.addEventListener("abort", () => {
            clearTimeout(timer);
            reject(new Error("Aborted"));
          });
        });
      } catch (err: any) {
        const reason = String(input.signal.reason);
        if (reason.includes("timed out")) {
          timedOut = true;
        } else {
          cancelled = true;
        }
      }
    }

    const mockStdout = response.stdout ?? (response.text ?? "mock response");
    const mockStderr = response.stderr ?? "";
    
    await appendToLogs("stdout", mockStdout, redactors.stdoutRedactor);
    await appendToLogs("stderr", mockStderr, redactors.stderrRedactor);

    return {
      exitCode: response.exitCode !== undefined ? response.exitCode : 0,
      timedOut: timedOut || !!response.timeout,
      cancelled: cancelled || (!!response.fail && response.error?.code === "USER_CANCELLED")
    };
  }

  private async executeProcess(
    input: AgentExecutionInput,
    runInput: AgentRunInput,
    commandInput: any,
    adapter: any,
    appendToLogs: (stream: "stdout" | "stderr", chunk: string, redactor: StreamRedactor) => Promise<void>,
    redactors: { stdoutRedactor: StreamRedactor; stderrRedactor: StreamRedactor }
  ): Promise<{ exitCode: number | null; timedOut: boolean; cancelled: boolean }> {
    try {
      const filteredEnv = buildProviderEnv({
        baseEnv: process.env,
        passEnv: this.config.security?.passEnv ?? [],
        explicitEnv: commandInput.env
      });
      const processResult = await runProcess({
        command: commandInput.command,
        args: commandInput.args,
        cwd: commandInput.cwd,
        ...(commandInput.stdin !== undefined ? { stdin: commandInput.stdin } : {}),
        env: filteredEnv,
        timeoutMs: input.timeoutMs,
        signal: input.signal,
        onStdout: async (chunk) => {
          await appendToLogs("stdout", chunk, redactors.stdoutRedactor);
        },
        onStderr: async (chunk) => {
          await appendToLogs("stderr", chunk, redactors.stderrRedactor);
        }
      });
      return processResult;
    } catch (err: any) {
      if (err.message?.includes("timeout") || err.code === "PROCESS_TIMEOUT") {
        return { exitCode: null, timedOut: true, cancelled: false };
      } else if (err.name === "AbortError" || input.signal?.aborted) {
        return { exitCode: null, timedOut: false, cancelled: true };
      } else {
        const errorMsg = `\nError running process: ${err.message}`;
        await appendToLogs("stderr", errorMsg, redactors.stderrRedactor);
        return { exitCode: 1, timedOut: false, cancelled: false };
      }
    }
  }
}
