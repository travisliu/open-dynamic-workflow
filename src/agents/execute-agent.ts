import type { AgentExecutor, AgentExecutionInput } from "./execution-types.js";
import type { AgentResult, AgentSuccessResult, AgentFailureResult, AgentRunInput } from "../types/agent.js";
import type { ResolvedConfig } from "../types/config.js";
import type { ArtifactStore } from "../types/artifacts.js";
import { EventBus } from "../orchestration/event-bus.js";
import { createDefaultProviderRegistry } from "./registry.js";
import { runProcess } from "./process-runner.js";
import { validateJson } from "../structured/validate-json.js";
import { normalizeAgentOutput } from "../structured/normalize-agent-output.js";
import { buildProviderEnv, shouldRedactEnvName, redactText, StreamRedactor } from "../security/env.js";
import * as fs from "node:fs/promises";

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

    // 1. Write prompt.txt
    await this.artifactStore.writeText(`agents/${input.id}/prompt.txt`, input.prompt);

    // 2. Write schema.json if schema is provided
    let absoluteSchemaPath: string | undefined;
    if (input.schema) {
      absoluteSchemaPath = await this.artifactStore.writeJson(
        `agents/${input.id}/schema.json`,
        schemaForProviderArtifact(input)
      );
    }

    // Write metadata.json
    const metadataJson = {
      model: input.model,
      resolutionSource: input.metadata?.modelResolutionSource || "provider-default",
      structuredOutputTransport: input.schema ? input.structuredOutput?.transport ?? "auto" : undefined
    };
    await this.artifactStore.writeJson(`agents/${input.id}/metadata.json`, metadataJson);

    // Initialize empty log files
    await this.artifactStore.writeText(`agents/${input.id}/stdout.log`, "");
    await this.artifactStore.writeText(`agents/${input.id}/stderr.log`, "");
    const absoluteLastMessagePath = await this.artifactStore.writeText(`agents/${input.id}/last-message.txt`, "");

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

    const agentArtifacts = {
      dir: `agents/${input.id}`,
      promptPath: `agents/${input.id}/prompt.txt`,
      stdoutPath: `agents/${input.id}/stdout.log`,
      stderrPath: `agents/${input.id}/stderr.log`,
      lastMessagePath: `agents/${input.id}/last-message.txt`,
      rawResultPath: `agents/${input.id}/raw-result.json`,
      normalizedResultPath: `agents/${input.id}/normalized-result.json`,
      metadataPath: `agents/${input.id}/metadata.json`
    } as any;

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
      schemaPath: absoluteSchemaPath,
      lastMessagePath: absoluteLastMessagePath,
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
        error: errorPayload
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
        error: errPayload
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
        error: errPayload
      };
      await this.artifactStore.writeJson(`agents/${input.id}/raw-result.json`, failureResult);
      return failureResult;
    }

    if (exitCode !== null && exitCode !== 0) {
      const message = providerFailureMessage(stdoutInMemory, stderrInMemory, exitCode);
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
          message,
          code: "PROVIDER_PROCESS_FAILED"
        }
      };
      await this.artifactStore.writeJson(`agents/${input.id}/raw-result.json`, failureResult);
      return failureResult;
    }

    let lastMessage: string | undefined;
    try {
      lastMessage = await fs.readFile(absoluteLastMessagePath, "utf8");
    } catch {
      lastMessage = undefined;
    }

    let parseResult;
    try {
      parseResult = await adapter.parseResult({
        input: runInput,
        stdout: stdoutInMemory,
        stderr: stderrInMemory,
        exitCode,
        lastMessage
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
        }
      };
      await this.artifactStore.writeJson(`agents/${input.id}/raw-result.json`, failureResult);
      return failureResult;
    }

    await this.artifactStore.writeJson(`agents/${input.id}/raw-result.json`, parseResult.raw ?? parseResult);

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
        usage: parseResult.usage,
        threadId: parseResult.threadId,
        providerMetadata: parseResult.providerMetadata
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
      usage: parseResult.usage,
      threadId: parseResult.threadId,
      providerMetadata: parseResult.providerMetadata
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

function schemaForProviderArtifact(input: AgentExecutionInput): unknown {
  if (
    input.provider === "codex" &&
    input.schema &&
    ((input.structuredOutput?.transport ?? "auto") === "auto" ||
      input.structuredOutput?.transport === "native")
  ) {
    return withAdditionalPropertiesFalse(input.schema);
  }
  return input.schema;
}

function withAdditionalPropertiesFalse(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(withAdditionalPropertiesFalse);
  }
  if (!value || typeof value !== "object") {
    return value;
  }

  const input = value as Record<string, unknown>;
  const output: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(input)) {
    output[key] = withAdditionalPropertiesFalse(nested);
  }

  const isObjectSchema =
    input.type === "object" ||
    input.properties !== undefined ||
    input.patternProperties !== undefined;
  if (isObjectSchema && output.additionalProperties === undefined) {
    output.additionalProperties = false;
  }

  return output;
}

function providerFailureMessage(stdout: string, stderr: string, exitCode: number): string {
  const jsonlMessage = extractJsonlFailureMessage(stdout);
  return jsonlMessage || stderr.trim() || `Process exited with code ${exitCode}`;
}

function extractJsonlFailureMessage(stdout: string): string | undefined {
  const messages: string[] = [];
  for (const line of stdout.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    try {
      const event = JSON.parse(trimmed);
      if (event?.type === "error" && typeof event.message === "string") {
        messages.push(normalizeNestedProviderMessage(event.message));
      }
      if (event?.type === "turn.failed" && typeof event.error?.message === "string") {
        messages.push(normalizeNestedProviderMessage(event.error.message));
      }
    } catch {
      // Ignore non-JSONL output.
    }
  }
  return messages.at(-1);
}

function normalizeNestedProviderMessage(message: string): string {
  try {
    const parsed = JSON.parse(message);
    if (typeof parsed?.error?.message === "string") {
      return parsed.error.message;
    }
  } catch {
    // Plain text message.
  }
  return message;
}
