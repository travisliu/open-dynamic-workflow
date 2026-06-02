import type { AgentExecutor, AgentExecutionInput } from "./execution-types.js";
import type { AgentResult, AgentSuccessResult, AgentFailureResult, AgentRunInput } from "../types/agent.js";
import type { ResolvedConfig } from "../types/config.js";
import type { ArtifactStore } from "../types/artifacts.js";
import { EventBus } from "../orchestration/event-bus.js";
import { createDefaultProviderRegistry } from "./registry.js";
import { runProcess } from "./process-runner.js";
import { validateJson } from "../structured/validate-json.js";
import { buildProviderEnv, shouldRedactEnvName, redactText } from "../security/env.js";

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
    if (input.schema) {
      await this.artifactStore.writeJson(`agents/${input.id}/schema.json`, input.schema);
    }

    // Initialize empty log files to ensure they exist even if no output is produced
    await this.artifactStore.writeText(`agents/${input.id}/stdout.log`, "");
    await this.artifactStore.writeText(`agents/${input.id}/stderr.log`, "");

    const secretPatterns = this.config.security?.redactEnv ?? [];
    const secretValues: string[] = [];
    for (const [key, value] of Object.entries(process.env)) {
      if (value && shouldRedactEnvName(key, secretPatterns)) {
        secretValues.push(value);
      }
    }

    const startMs = Date.now();
    let stdout = "";
    let stderr = "";
    let exitCode: number | null = null;
    let timedOut = false;
    let cancelled = false;

    // Run input
    const runInput: AgentRunInput = {
      id: input.id,
      label: input.label,
      provider: input.provider,
      prompt: input.prompt,
      model: input.model,
      schema: input.schema,
      timeoutMs: input.timeoutMs,
      cwd: input.cwd,
      env: {},
      metadata: input.metadata
    };

    if (input.provider === "mock") {
      // Mock execution path
      const mockAdapter = adapter as any;
      const response = mockAdapter.lookupResponse(runInput);

      if (response.delayMs) {
        await new Promise((resolve) => setTimeout(resolve, response.delayMs));
      }

      stdout = redactText(response.stdout ?? (response.text ?? "mock response"), secretValues);
      stderr = redactText(response.stderr ?? "", secretValues);
      exitCode = response.exitCode !== undefined ? response.exitCode : 0;
      timedOut = !!response.timeout;
      cancelled = !!response.fail && response.error?.code === "USER_CANCELLED";

      // Stream mock output to event bus and durable logs
      if (stdout) {
        await this.artifactStore.appendText(`agents/${input.id}/stdout.log`, stdout);
        await this.eventBus.emit("agent.output", { agentId: input.id, stream: "stdout", data: stdout });
      }
      if (stderr) {
        await this.artifactStore.appendText(`agents/${input.id}/stderr.log`, stderr);
        await this.eventBus.emit("agent.output", { agentId: input.id, stream: "stderr", data: stderr });
      }
    } else {
      // Real process execution path
      const commandInput = await adapter.buildCommand(runInput);
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
          env: filteredEnv,
          timeoutMs: input.timeoutMs,
          signal: input.signal,
          onStdout: async (chunk) => {
            const redactedChunk = redactText(chunk, secretValues);
            stdout += redactedChunk;
            await this.artifactStore.appendText(`agents/${input.id}/stdout.log`, redactedChunk);
            await this.eventBus.emit("agent.output", { agentId: input.id, stream: "stdout", data: redactedChunk });
          },
          onStderr: async (chunk) => {
            const redactedChunk = redactText(chunk, secretValues);
            stderr += redactedChunk;
            await this.artifactStore.appendText(`agents/${input.id}/stderr.log`, redactedChunk);
            await this.eventBus.emit("agent.output", { agentId: input.id, stream: "stderr", data: redactedChunk });
          }
        });
        exitCode = processResult.exitCode;
        timedOut = processResult.timedOut;
        cancelled = processResult.cancelled;
      } catch (err: any) {
        if (err.message?.includes("timeout") || err.code === "PROCESS_TIMEOUT") {
          timedOut = true;
        } else if (err.name === "AbortError" || input.signal?.aborted) {
          cancelled = true;
        } else {
          exitCode = exitCode ?? 1;
          const errorMsg = `\nError running process: ${err.message}`;
          stderr += errorMsg;
          await this.artifactStore.appendText(`agents/${input.id}/stderr.log`, errorMsg);
        }
      }
    }

    const durationMs = Date.now() - startMs;

    // Output is already redacted as it is collected/appended
    const redactedStdout = stdout;
    const redactedStderr = stderr;

    const agentArtifacts = {
      dir: `agents/${input.id}`,
      promptPath: `agents/${input.id}/prompt.txt`,
      stdoutPath: `agents/${input.id}/stdout.log`,
      stderrPath: `agents/${input.id}/stderr.log`,
      rawResultPath: `agents/${input.id}/raw-result.json`,
      normalizedResultPath: `agents/${input.id}/normalized-result.json`
    } as any;

    if (input.schema) {
      agentArtifacts.schemaPath = `agents/${input.id}/schema.json`;
    }

    // Determine success/failure status based on precedence

    // Precedence 1: Timeout
    if (timedOut) {
      const errPayload = { name: "TimeoutError", message: "Agent execution timed out", code: "PROCESS_TIMEOUT" };
      const failureResult: AgentFailureResult = {
        ok: false,
        status: "timed_out",
        id: input.id,
        label: input.label,
        provider: input.provider,
        stdout: redactedStdout,
        stderr: redactedStderr,
        exitCode: null,
        durationMs,
        artifacts: agentArtifacts,
        error: errPayload
      };
      await this.artifactStore.writeJson(`agents/${input.id}/raw-result.json`, failureResult);
      return failureResult;
    }

    // Precedence 2: Cancellation
    if (cancelled) {
      const errPayload = { name: "CancelledError", message: "Agent execution was cancelled", code: "USER_CANCELLED" };
      const failureResult: AgentFailureResult = {
        ok: false,
        status: "cancelled",
        id: input.id,
        label: input.label,
        provider: input.provider,
        stdout: redactedStdout,
        stderr: redactedStderr,
        exitCode: null,
        durationMs,
        artifacts: agentArtifacts,
        error: errPayload
      };
      await this.artifactStore.writeJson(`agents/${input.id}/raw-result.json`, failureResult);
      return failureResult;
    }

    // Precedence 3: Process Failure (non-zero exit code)
    if (exitCode !== null && exitCode !== 0) {
      const failureResult: AgentFailureResult = {
        ok: false,
        status: "failed",
        id: input.id,
        label: input.label,
        provider: input.provider,
        stdout: redactedStdout,
        stderr: redactedStderr,
        exitCode,
        durationMs,
        artifacts: agentArtifacts,
        error: {
          name: "ProviderProcessFailed",
          message: redactedStderr.trim() || `Process exited with code ${exitCode}`,
          code: "PROVIDER_PROCESS_FAILED"
        }
      };
      await this.artifactStore.writeJson(`agents/${input.id}/raw-result.json`, failureResult);
      return failureResult;
    }

    // Precedence 4: Parse Result
    let parseResult;
    try {
      parseResult = await adapter.parseResult({
        agentId: input.id,
        provider: input.provider,
        stdout: redactedStdout,
        stderr: redactedStderr,
        exitCode,
        signal: null,
        input: runInput
      } as any);
    } catch (err: any) {
      const failureResult: AgentFailureResult = {
        ok: false,
        status: "failed",
        id: input.id,
        label: input.label,
        provider: input.provider,
        stdout: redactedStdout,
        stderr: redactedStderr,
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

    // Precedence 5: Schema Validation
    if (input.schema) {
      const valResult = validateJson(parseResult.json, input.schema);
      if (!valResult.ok) {
        agentArtifacts.validationErrorPath = `agents/${input.id}/validation-error.json`;
        await this.artifactStore.writeJson(`agents/${input.id}/validation-error.json`, valResult.errors);

        const failureResult: AgentFailureResult = {
          ok: false,
          status: "failed",
          id: input.id,
          label: input.label,
          provider: input.provider,
          stdout: redactedStdout,
          stderr: redactedStderr,
          exitCode,
          durationMs,
          artifacts: agentArtifacts,
          error: {
            name: "ValidationError",
            message: valResult.message,
            code: "SCHEMA_VALIDATION_FAILED"
          }
        };
        return failureResult;
      }
    }

    // Write normalized result if successful
    await this.artifactStore.writeJson(`agents/${input.id}/normalized-result.json`, parseResult.json ?? parseResult.text);

    const successResult: AgentSuccessResult = {
      ok: true,
      status: "succeeded",
      id: input.id,
      label: input.label,
      provider: input.provider,
      text: redactText(parseResult.text ?? "", secretValues),
      json: parseResult.json,
      stdout: redactedStdout,
      stderr: redactedStderr,
      exitCode: exitCode ?? 0,
      durationMs,
      artifacts: agentArtifacts
    };

    return successResult;
  }
}
