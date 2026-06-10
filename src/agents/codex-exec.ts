import type {
  AgentAdapter,
  ProviderHealth,
  AgentRunInput,
  ProviderCommand,
  ProviderParseInput,
  ProviderParsedResult,
  AgentUsage,
  ProviderConfig
} from "./types.js";
import { runProcess } from "./process-runner.js";
import { shouldRedactEnvName } from "../security/env.js";
import { appendModelArg } from "./model-args.js";
import { resolveStructuredOutputPrompt } from "../structured/structured-output.js";
import { OpenFlowError } from "../errors/types.js";
import { ErrorCode } from "../errors/codes.js";

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
        timeoutMs: 2000
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

  capabilities() {
    return {
      prompt: {
        transports: ["stdin" as const, "argv" as const]
      },
      output: {
        formats: ["text" as const, "json" as const, "jsonl" as const]
      },
      structuredOutput: {
        modes: ["prompt" as const, "validate-only" as const]
      },
      usage: {
        source: "final-event" as const
      },
      sessions: {
        modes: ["ephemeral" as const]
      },
      permissions: {
        modes: ["none" as const]
      }
    };
  }

  async buildCommand(input: AgentRunInput): Promise<ProviderCommand> {
    const command = this.config.command ?? "codex";
    const baseArgs = this.config.args ?? ["exec", "--json", "--ephemeral"];
    const args = [...baseArgs];
    const structuredPrompt = resolveStructuredOutputPrompt({
      prompt: input.prompt,
      schema: input.schema,
      structuredOutput: input.structuredOutput
    });

    if (structuredPrompt.nativeRequested) {
      throw new OpenFlowError(
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
        const summary = extractCodexEventSummary(events);
        const failure = extractCodexFailure(events);
        if (failure) {
          const result: ProviderParsedResult = {
            text: input.stdout,
            raw: {
              format: "codex-jsonl",
              events
            },
            failure,
            ...summary
          };
          if (warnings.length > 0) {
            result.parseWarnings = warnings;
          }
          return result;
        }

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
            },
            ...summary
          };
          if (warnings.length > 0) {
            result.parseWarnings = warnings;
          }
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
            },
            ...summary
          };
          if (warnings.length > 0) {
            result.parseWarnings = warnings;
          }
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
          parseWarnings: finalWarnings,
          ...summary
        };
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

function extractCodexEventSummary(events: unknown[]): Pick<ProviderParsedResult, "usage" | "providerThreadId" | "providerMetadata"> {
  let providerThreadId: string | undefined;
  let rawUsage: unknown;

  for (const event of events) {
    if (!event || typeof event !== "object" || Array.isArray(event)) {
      continue;
    }
    const record = event as Record<string, unknown>;
    if (record.type === "thread.started" && typeof record.thread_id === "string") {
      providerThreadId = record.thread_id;
    }
    if (record.type === "turn.completed" && record.usage !== undefined) {
      rawUsage = record.usage;
    }
  }

  const usage = normalizeCodexUsage(rawUsage);
  const summary: Pick<ProviderParsedResult, "usage" | "providerThreadId" | "providerMetadata"> = {};
  if (usage !== undefined) {
    summary.usage = usage;
  }
  if (providerThreadId !== undefined) {
    summary.providerThreadId = providerThreadId;
  }
  if (rawUsage !== undefined) {
    summary.providerMetadata = { usage: rawUsage };
  }
  return summary;
}

function normalizeCodexUsage(usage: unknown): AgentUsage | undefined {
  if (!usage || typeof usage !== "object" || Array.isArray(usage)) {
    return undefined;
  }
  const record = usage as Record<string, unknown>;
  const normalized: AgentUsage = {};
  const inputTokens = readNumber(record.input_tokens, record.inputTokens);
  const cachedInputTokens = readNumber(record.cached_input_tokens, record.cachedInputTokens);
  const outputTokens = readNumber(record.output_tokens, record.outputTokens);
  const reasoningOutputTokens = readNumber(record.reasoning_output_tokens, record.reasoningOutputTokens);
  const totalTokens = readNumber(record.total_tokens, record.totalTokens);

  if (inputTokens !== undefined) normalized.inputTokens = inputTokens;
  if (cachedInputTokens !== undefined) normalized.cachedInputTokens = cachedInputTokens;
  if (outputTokens !== undefined) normalized.outputTokens = outputTokens;
  if (reasoningOutputTokens !== undefined) normalized.reasoningOutputTokens = reasoningOutputTokens;
  if (totalTokens !== undefined) {
    normalized.totalTokens = totalTokens;
  } else if (inputTokens !== undefined || outputTokens !== undefined) {
    normalized.totalTokens = (inputTokens ?? 0) + (outputTokens ?? 0);
  }

  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

function readNumber(...values: unknown[]): number | undefined {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
  }
  return undefined;
}

function extractCodexFailure(events: unknown[]): ProviderParsedResult["failure"] | undefined {
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i];
    if (!event || typeof event !== "object" || Array.isArray(event)) {
      continue;
    }
    const record = event as Record<string, unknown>;
    const type = typeof record.type === "string" ? record.type : "";
    if (!isCodexFailureEventType(type)) {
      continue;
    }
    return {
      name: "ProviderReportedFailure",
      message: extractFailureMessage(record) ?? `Codex reported terminal event '${type}'.`,
      code: "PROVIDER_REPORTED_FAILURE",
      raw: record
    };
  }
  return undefined;
}

function isCodexFailureEventType(type: string): boolean {
  return type === "error" || type === "turn.failed" || type === "turn.error" || type.endsWith(".failed") || type.endsWith(".error");
}

function extractFailureMessage(record: Record<string, unknown>): string | undefined {
  if (typeof record.message === "string") {
    return record.message;
  }
  if (record.error && typeof record.error === "object" && !Array.isArray(record.error)) {
    const error = record.error as Record<string, unknown>;
    if (typeof error.message === "string") {
      return error.message;
    }
    if (typeof error.error === "string") {
      return error.error;
    }
  }
  if (typeof record.error === "string") {
    return record.error;
  }
  return undefined;
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
