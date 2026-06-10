import type {
  AgentAdapter,
  AgentUsage,
  ProviderHealth,
  AgentRunInput,
  ProviderCommand,
  ProviderParseInput,
  ProviderParsedResult,
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

  async buildCommand(input: AgentRunInput): Promise<ProviderCommand> {
    const command = this.config.command ?? "codex";
    const reviewMode = input.metadata?.codexMode === "review";
    const usesDefaultArgs = this.config.args === undefined;
    const baseArgs = this.config.args ?? (reviewMode ? ["exec", "review", "--json"] : ["exec", "--json"]);
    const args = usesDefaultArgs ? buildCodexArgsPrefix(input, this.config) : [];
    args.push(...baseArgs);

    const structuredPrompt = resolveCodexStructuredPrompt(input, usesDefaultArgs);

    const model = input.model ?? this.config.defaultModel ?? undefined;
    appendModelArg(args, model, this.config.modelArg, "--model");
    if (usesDefaultArgs) {
      appendCodexRunOptions(args, input, this.config);
    }

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
    const lastMessage = input.lastMessage?.trim();
    if (lastMessage) {
      const summary = summarizeCodexEvents(input.stdout);
      return resultFromMessageText(lastMessage, {
        format: "codex-last-message",
        lastMessage,
        jsonl: summary
      }, undefined, metadataFromSummary(summary));
    }

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
          return resultFromMessageText(parsed.text, parsed, parsed);
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
          const summary = extractCodexEventSummary(events);
          const result: ProviderParsedResult = {
            text: structured.text,
            json: parsedJson,
            structuredJson: parsedJson,
            raw: {
              format: "codex-jsonl",
              events,
              selectedEventIndex: structured.index,
              selectedMessageText: structured.text,
              ...summary
            },
            ...metadataFromSummary(summary)
          };
          if (warnings.length > 0) {
            result.parseWarnings = warnings;
          }
          return result;
        }

        // Rule 4. For plain-text scenarios, prefer the last non-empty agent_message
        const plaintext = selectPlaintextCandidate(messages);
        if (plaintext) {
          const summary = extractCodexEventSummary(events);
          const result: ProviderParsedResult = {
            text: plaintext.text,
            raw: {
              format: "codex-jsonl",
              events,
              selectedEventIndex: plaintext.index,
              selectedMessageText: plaintext.text,
              ...summary
            },
            ...metadataFromSummary(summary)
          };
          if (warnings.length > 0) {
            result.parseWarnings = warnings;
          }
          return result;
        }

        // Edge case 2: JSONL stream with no agent_message
        const finalWarnings = [...warnings, "No agent_message event found in JSONL stream"];
        const summary = extractCodexEventSummary(events);
        const result: ProviderParsedResult = {
          text: input.stdout,
          raw: {
            format: "codex-jsonl",
            events,
            ...summary
          },
          parseWarnings: finalWarnings,
          ...metadataFromSummary(summary)
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

function buildCodexArgsPrefix(input: AgentRunInput, config: CodexProviderConfig): string[] {
  const args: string[] = [];
  args.push("-C", input.cwd);

  if (config.sandbox) {
    args.push("-s", config.sandbox);
  }
  if (config.approval) {
    args.push("-a", config.approval);
  }
  if (config.profile) {
    args.push("-p", config.profile);
  }
  if (config.profileV2) {
    args.push("--profile-v2", config.profileV2);
  }
  for (const value of config.config ?? []) {
    args.push("-c", value);
  }
  for (const dir of config.addDir ?? []) {
    args.push("--add-dir", dir);
  }

  return args;
}

function appendCodexRunOptions(args: string[], input: AgentRunInput, config: CodexProviderConfig): void {
  if (input.schema && input.schemaPath && shouldUseNativeSchema(input)) {
    args.push("--output-schema", input.schemaPath);
  }
  if (input.lastMessagePath) {
    args.push("-o", input.lastMessagePath);
  }
  if (config.ephemeral !== false) {
    args.push("--ephemeral");
  }
  if (config.ignoreUserConfig) {
    args.push("--ignore-user-config");
  }
  if (config.ignoreRules) {
    args.push("--ignore-rules");
  }
  if (config.skipGitRepoCheck) {
    args.push("--skip-git-repo-check");
  }

  if (input.metadata?.codexMode === "review") {
    const review = input.metadata?.codexReview;
    if (review && typeof review === "object" && !Array.isArray(review)) {
      if ((review as any).uncommitted) args.push("--uncommitted");
      if (typeof (review as any).base === "string") args.push("--base", (review as any).base);
      if (typeof (review as any).commit === "string") args.push("--commit", (review as any).commit);
      if (typeof (review as any).title === "string") args.push("--title", (review as any).title);
    }
  }
}

function resolveCodexStructuredPrompt(input: AgentRunInput, canUseNativeSchema: boolean): { prompt: string } {
  if (canUseNativeSchema && input.schema && shouldUseNativeSchema(input)) {
    if (!input.schemaPath && input.structuredOutput?.transport === "native") {
      throw new OpenFlowError(
        ErrorCode.CLI_USAGE_ERROR,
        'Codex structuredOutput.transport="native" requires an artifact schemaPath.'
      );
    }
    if (input.schemaPath) {
      return { prompt: input.prompt };
    }
  }

  const structuredPrompt = resolveStructuredOutputPrompt({
    prompt: input.prompt,
    schema: input.schema,
    structuredOutput: input.structuredOutput
  });

  if (structuredPrompt.nativeRequested) {
    throw new OpenFlowError(
      ErrorCode.CLI_USAGE_ERROR,
      'Codex structuredOutput.transport="native" requires an artifact schemaPath.'
    );
  }

  return { prompt: structuredPrompt.prompt };
}

function shouldUseNativeSchema(input: AgentRunInput): boolean {
  const transport = input.structuredOutput?.transport ?? "auto";
  return transport === "auto" || transport === "native";
}

function resultFromMessageText(
  text: string,
  raw: unknown,
  jsonOverride?: unknown,
  metadata?: Pick<ProviderParsedResult, "usage" | "threadId" | "providerMetadata">
): ProviderParsedResult {
  const structured = tryParseEmbeddedJson(text);
  const result: ProviderParsedResult = {
    text,
    raw
  };
  if (jsonOverride !== undefined) {
    result.json = jsonOverride;
  } else if (structured !== undefined) {
    result.json = structured;
  }
  if (structured !== undefined) {
    result.structuredJson = structured;
  }
  if (metadata?.usage !== undefined) result.usage = metadata.usage;
  if (metadata?.threadId !== undefined) result.threadId = metadata.threadId;
  if (metadata?.providerMetadata !== undefined) result.providerMetadata = metadata.providerMetadata;
  return result;
}

function summarizeCodexEvents(stdout: string): Record<string, unknown> | undefined {
  const jsonlResult = tryParseJsonLines(stdout.trim());
  if (!jsonlResult) {
    return undefined;
  }
  return {
    events: jsonlResult.events,
    warnings: jsonlResult.warnings,
    ...extractCodexEventSummary(jsonlResult.events)
  };
}

function extractCodexEventSummary(events: unknown[]): Record<string, unknown> {
  let threadId: string | undefined;
  let usage: unknown;
  const failures: unknown[] = [];
  const errors: unknown[] = [];

  for (const event of events) {
    if (!event || typeof event !== "object" || Array.isArray(event)) {
      continue;
    }
    const typed = event as any;
    if (typed.type === "thread.started" && typeof typed.thread_id === "string") {
      threadId = typed.thread_id;
    }
    if (typed.type === "turn.completed" && typed.usage !== undefined) {
      usage = typed.usage;
    }
    if (typed.type === "turn.failed") {
      failures.push(typed);
    }
    if (typed.type === "error") {
      errors.push(typed);
    }
  }

  const summary: Record<string, unknown> = {};
  if (threadId !== undefined) summary.threadId = threadId;
  if (usage !== undefined) summary.usage = usage;
  const normalizedUsage = normalizeCodexUsage(usage);
  if (normalizedUsage !== undefined) summary.normalizedUsage = normalizedUsage;
  if (failures.length > 0) summary.failures = failures;
  if (errors.length > 0) summary.errors = errors;
  return summary;
}

function metadataFromSummary(summary: Record<string, unknown> | undefined): Pick<ProviderParsedResult, "usage" | "threadId" | "providerMetadata"> {
  const metadata: Pick<ProviderParsedResult, "usage" | "threadId" | "providerMetadata"> = {};
  if (!summary) return metadata;

  if (typeof summary.threadId === "string") {
    metadata.threadId = summary.threadId;
  }
  if (summary.normalizedUsage && typeof summary.normalizedUsage === "object" && !Array.isArray(summary.normalizedUsage)) {
    metadata.usage = summary.normalizedUsage as AgentUsage;
  }

  const providerMetadata: Record<string, unknown> = {};
  if (summary.usage !== undefined) providerMetadata.usage = summary.usage;
  if (summary.failures !== undefined) providerMetadata.failures = summary.failures;
  if (summary.errors !== undefined) providerMetadata.errors = summary.errors;
  if (Object.keys(providerMetadata).length > 0) {
    metadata.providerMetadata = providerMetadata;
  }
  return metadata;
}

export function normalizeCodexUsage(usage: unknown): AgentUsage | undefined {
  if (!usage || typeof usage !== "object" || Array.isArray(usage)) {
    return undefined;
  }
  const raw = usage as Record<string, unknown>;
  const inputTokens = numberFromUnknown(raw.input_tokens ?? raw.inputTokens);
  const cachedInputTokens = numberFromUnknown(raw.cached_input_tokens ?? raw.cachedInputTokens);
  const outputTokens = numberFromUnknown(raw.output_tokens ?? raw.outputTokens);
  const reasoningOutputTokens = numberFromUnknown(raw.reasoning_output_tokens ?? raw.reasoningOutputTokens);
  const totalTokens = numberFromUnknown(raw.total_tokens ?? raw.totalTokens);

  const normalized: AgentUsage = {};
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

function numberFromUnknown(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
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
