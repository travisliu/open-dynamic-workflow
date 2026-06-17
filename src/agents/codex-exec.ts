import type {
  AgentAdapter,
  ProviderHealth,
  AgentRunInput,
  ProviderCommand,
  ProviderParseInput,
  ProviderParsedResult,
  ProviderConfig
} from "./types.js";
import { runProcess } from "./process-runner.js";
import { buildProviderEnv, shouldRedactEnvName } from "../security/env.js";
import { appendModelArg } from "./model-args.js";
import { resolveStructuredOutputPrompt } from "../structured/structured-output.js";
import { OpenDynamicWorkflowError } from "../errors/types.js";
import { ErrorCode } from "../errors/codes.js";
import type { AgentUsage, ProviderFailure } from "../types/agent.js";

export interface CodexProviderConfig extends ProviderConfig {
  promptMode?: "stdin" | "arg";
}

export class CodexExecAdapter implements AgentAdapter {
  readonly name = "codex";
  private readonly config: CodexProviderConfig;

  constructor(config?: CodexProviderConfig) {
    this.config = config ?? { command: "codex" };
  }

  async checkHealth(): Promise<ProviderHealth> {
    const command = this.config.command ?? "codex";
    try {
      // Cheap process call to verify availability
      await runProcess({
        command,
        args: ["--help"],
        cwd: process.cwd(),
        env: buildProviderEnv({
          baseEnv: process.env,
          passEnv: [],
          explicitEnv: {}
        }),
        timeoutMs: 5000
      });
      return {
        provider: "codex",
        available: true,
        command,
        supportsModelSelection: this.config.modelArg !== false
      };
    } catch (err) {
      return {
        provider: "codex",
        available: false,
        command,
        message: `Command '${command}' is not available.`,
        error: {
          name: (err as Error).name,
          message: (err as Error).message
        },
        supportsModelSelection: this.config.modelArg !== false
      };
    }
  }

  async buildCommand(input: AgentRunInput): Promise<ProviderCommand> {
    const command = this.config.command ?? "codex";
    const baseArgs = this.config.args ?? ["exec", "--json", "--ephemeral"];
    const args = [...baseArgs];

    if (input.permissions?.mode === "dangerously-full-access") {
      args.push("--dangerously-bypass-approvals-and-sandbox");
    }
    const structuredPrompt = resolveStructuredOutputPrompt({
      prompt: input.prompt,
      schema: input.schema,
      structuredOutput: input.structuredOutput
    });

    if (structuredPrompt.nativeRequested) {
      throw new OpenDynamicWorkflowError(
        ErrorCode.CLI_USAGE_ERROR,
        'Codex does not support structuredOutput.transport="native" yet.'
      );
    }

    const model = input.model ?? this.config.defaultModel ?? undefined;
    appendModelArg(args, model, this.config.modelArg, "--model");

    const promptMode = this.config.promptMode ?? "stdin";
    let stdin: string | undefined = undefined;

    if (promptMode === "stdin") {
      stdin = structuredPrompt.prompt;
    } else {
      args.push(structuredPrompt.prompt);
    }

    const filteredEnv: Record<string, string> = {};
    for (const [key, value] of Object.entries(input.env)) {
      if (!shouldRedactEnvName(key)) {
        filteredEnv[key] = value;
      }
    }

    const cmd: ProviderCommand = {
      command,
      args,
      cwd: input.cwd,
      env: filteredEnv
    };
    if (stdin !== undefined) {
      cmd.stdin = stdin;
    }
    return cmd;
  }

  async parseResult(input: ProviderParseInput): Promise<ProviderParsedResult> {
    const trimmed = input.stdout.trim();
    if (!trimmed) {
      return {
        text: "",
        parseWarnings: ["Empty stdout"]
      };
    }

    // Rule 1. Single-document JSON wins when it fully parses
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed && typeof parsed === "object") {
        if (typeof parsed.text === "string") {
          const structured = tryParseEmbeddedJson(parsed.text);
          return {
            text: parsed.text,
            json: parsed,
            structuredJson: structured,
            raw: parsed
          };
        }
        return {
          json: parsed,
          structuredJson: parsed,
          raw: parsed
        };
      }
      return {
        text: trimmed,
        parseWarnings: ["Parsed JSON is not an object or array"]
      };
    } catch (err) {
      // It is not a single valid JSON document. Let's try to parse as JSONL.
      const jsonlResult = tryParseJsonLines(trimmed);
      if (jsonlResult) {
        const { events, warnings } = jsonlResult;
        const messages = extractAgentMessageTexts(events);

        // Rule 3. For structured-output scenarios, prefer the last JSON-shaped agent_message
        const structured = selectStructuredCandidate(messages);
        if (structured) {
          const parsedJson = tryParseEmbeddedJson(structured.text);
          const result: ProviderParsedResult = {
            text: structured.text,
            json: parsedJson,
            structuredJson: parsedJson,
            raw: {
              format: "codex-jsonl",
              events,
              selectedEventIndex: structured.index,
              selectedMessageText: structured.text
            }
          };
          if (warnings.length > 0) {
            result.parseWarnings = warnings;
          }
          attachCodexJsonlMetadata(result, events);
          return result;
        }

        // Rule 4. For plain-text scenarios, prefer the last non-empty agent_message
        const plaintext = selectPlaintextCandidate(messages);
        if (plaintext) {
          const result: ProviderParsedResult = {
            text: plaintext.text,
            raw: {
              format: "codex-jsonl",
              events,
              selectedEventIndex: plaintext.index,
              selectedMessageText: plaintext.text
            }
          };
          if (warnings.length > 0) {
            result.parseWarnings = warnings;
          }
          attachCodexJsonlMetadata(result, events);
          return result;
        }

        // Edge case 2: JSONL stream with no agent_message
        const finalWarnings = [...warnings, "No agent_message event found in JSONL stream"];
        const result: ProviderParsedResult = {
          text: input.stdout,
          raw: {
            format: "codex-jsonl",
            events
          },
          parseWarnings: finalWarnings
        };
        attachCodexJsonlMetadata(result, events);
        return result;
      }

      // If it's not a valid JSONL stream either, fall back to plain text with the original single-document parse error
      return {
        text: input.stdout,
        parseWarnings: [`Malformed JSON: ${(err as Error).message}`]
      };
    }
  }
}

function tryParseJsonLines(stdout: string): { events: unknown[]; warnings: string[] } | null {
  const lines = stdout.split(/\r?\n/);
  const events: unknown[] = [];
  const warnings: string[] = [];
  let parsedCount = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line === undefined) {
      continue;
    }
    const trimmedLine = line.trim();
    if (!trimmedLine) {
      continue;
    }
    try {
      const parsed = JSON.parse(trimmedLine);
      events.push(parsed);
      parsedCount++;
    } catch (err) {
      warnings.push(`Line ${i + 1} is malformed JSON: ${(err as Error).message}`);
    }
  }

  // If more than one line parses successfully, treat the output as JSONL.
  if (parsedCount > 1) {
    return { events, warnings };
  }
  return null;
}

function attachCodexJsonlMetadata(result: ProviderParsedResult, events: unknown[]): void {
  const threadId = extractCodexThreadId(events);
  const usage = extractCodexUsage(events);
  const failure = extractCodexFailure(events);

  if (threadId !== undefined) {
    result.providerThreadId = threadId;
  }
  if (usage !== undefined) {
    result.usage = usage;
  }
  if (failure !== undefined) {
    result.failure = failure;
  }
}

function extractCodexThreadId(events: unknown[]): string | undefined {
  for (const event of events) {
    if (!isRecord(event)) continue;
    if (
      event.type === "thread.started" &&
      typeof event.thread_id === "string"
    ) {
      return event.thread_id;
    }
  }
  return undefined;
}

function extractCodexUsage(events: unknown[]): AgentUsage | undefined {
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i];
    if (!isRecord(event)) continue;
    if (event.type !== "turn.completed") continue;

    const usage = isRecord(event.usage) ? event.usage : undefined;
    if (!usage) continue;

    const normalized: AgentUsage = {};
    setNumber(normalized, "inputTokens", readNumber(usage, "input_tokens", "inputTokens"));
    setNumber(normalized, "cachedInputTokens", readNumber(usage, "cached_input_tokens", "cachedInputTokens"));
    setNumber(normalized, "outputTokens", readNumber(usage, "output_tokens", "outputTokens"));
    setNumber(normalized, "reasoningOutputTokens", readNumber(usage, "reasoning_output_tokens", "reasoningOutputTokens"));
    setNumber(normalized, "totalTokens", readNumber(usage, "total_tokens", "totalTokens"));

    if (normalized.totalTokens === undefined) {
      const inputTokens = normalized.inputTokens ?? 0;
      const outputTokens = normalized.outputTokens ?? 0;
      if (normalized.inputTokens !== undefined || normalized.outputTokens !== undefined) {
        normalized.totalTokens = inputTokens + outputTokens;
      }
    }

    return Object.keys(normalized).length > 0 ? normalized : undefined;
  }
  return undefined;
}

function extractCodexFailure(events: unknown[]): ProviderFailure | undefined {
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i];
    if (!isRecord(event)) continue;
    const type = typeof event.type === "string" ? event.type : "";
    if (type !== "turn.failed" && type !== "turn.error" && type !== "error") {
      continue;
    }

    const embeddedError = isRecord(event.error) ? event.error : undefined;
    const message =
      stringField(embeddedError, "message") ??
      stringField(event, "message") ??
      stringField(event, "error") ??
      "Codex reported a terminal failure.";

    return {
      name: stringField(embeddedError, "name") ?? "CodexProviderFailure",
      message,
      code: stringField(embeddedError, "code") ?? stringField(event, "code") ?? "PROVIDER_PROCESS_FAILED",
      details: event
    };
  }
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function stringField(record: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = record?.[key];
  return typeof value === "string" ? value : undefined;
}

function readNumber(record: Record<string, unknown>, snakeKey: string, camelKey: string): number | undefined {
  const value = record[snakeKey] ?? record[camelKey];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function setNumber(target: AgentUsage, key: keyof AgentUsage, value: number | undefined): void {
  if (value !== undefined) {
    target[key] = value;
  }
}

function extractAgentMessageTexts(events: unknown[]): Array<{ index: number; text: string }> {
  const messages: Array<{ index: number; text: string }> = [];
  for (let i = 0; i < events.length; i++) {
    const event = events[i];
    if (
      event &&
      typeof event === "object" &&
      !Array.isArray(event) &&
      (event as any).type === "item.completed" &&
      (event as any).item &&
      typeof (event as any).item === "object" &&
      !Array.isArray((event as any).item) &&
      (event as any).item.type === "agent_message" &&
      typeof (event as any).item.text === "string"
    ) {
      messages.push({
        index: i,
        text: (event as any).item.text
      });
    }
  }
  return messages;
}

function selectStructuredCandidate(messages: Array<{ index: number; text: string }>): { index: number; text: string } | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (!msg) {
      continue;
    }
    if (tryParseEmbeddedJson(msg.text) !== undefined) {
      return msg;
    }
  }
  return null;
}

function selectPlaintextCandidate(messages: Array<{ index: number; text: string }>): { index: number; text: string } | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (!msg) {
      continue;
    }
    if (msg.text.trim() !== "") {
      return msg;
    }
  }
  return null;
}

function tryParseEmbeddedJson(text: string): unknown | undefined {
  const trimmed = text.trim();
  try {
    const parsed = JSON.parse(trimmed);
    if (parsed !== null && typeof parsed === "object") {
      return parsed;
    }
  } catch {
    // If it fails, check if the string contains a JSON block wrapped in markdown
    const match = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    if (match && match[1] !== undefined) {
      try {
        const parsed = JSON.parse(match[1].trim());
        if (parsed !== null && typeof parsed === "object") {
          return parsed;
        }
      } catch {}
    }
  }
  return undefined;
}
