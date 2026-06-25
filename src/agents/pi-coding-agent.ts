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
import { shouldRedactEnvName } from "../security/env.js";
import { appendModelArg } from "./model-args.js";
import { extractJson } from "../structured/extract-json.js";
import { resolveStructuredOutputPrompt } from "../structured/structured-output.js";
import { OpenDynamicWorkflowError } from "../errors/types.js";
import { ErrorCode } from "../errors/codes.js";
import { assertThinkingEffortSupported } from "./thinking-effort-support.js";

export type PiExecutionMode = "json" | "print";
export type PiApprovalMode = "approve" | "no-approve" | "omit";

export interface PiCodingAgentProviderConfig extends ProviderConfig {
  modelFlag?: string;
  providerFlag?: string;
  piProvider?: string;
  executionMode?: PiExecutionMode;
  promptMode?: "arg" | "stdin";
  noSession?: boolean;
  noContextFiles?: boolean;
  noExtensions?: boolean;
  noSkills?: boolean;
  noPromptTemplates?: boolean;
  noThemes?: boolean;
  approvalMode?: PiApprovalMode;
  safeTools?: string[];
  fullAccessTools?: string[];
  thinking?: string;
  systemPrompt?: string;
  appendSystemPrompt?: string;
  deterministicEnv?: boolean;
}

export class PiCodingAgentAdapter implements AgentAdapter {
  readonly name = "pi";
  private readonly config: PiCodingAgentProviderConfig;

  constructor(config?: PiCodingAgentProviderConfig) {
    this.config = config ?? { command: "pi" };
  }

  async checkHealth(): Promise<ProviderHealth> {
    const command = this.config.command ?? "pi";
    try {
      await runProcess({
        command,
        args: ["--help"],
        cwd: process.cwd(),
        timeoutMs: 2000
      });

      return {
        provider: "pi",
        available: true,
        command,
        supportsModelSelection: this.config.modelArg !== false
      };
    } catch (err) {
      return {
        provider: "pi",
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
    const command = this.config.command ?? "pi";
    const executionMode = this.config.executionMode ?? "json";
    const promptMode = this.config.promptMode ?? "arg";
    const defaultModelFlag = this.config.modelFlag ?? "--model";
    const providerFlag = this.config.providerFlag ?? "--provider";

    const structuredPrompt = resolveStructuredOutputPrompt({
      prompt: input.prompt,
      schema: input.schema,
      structuredOutput: input.structuredOutput
    });

    if (structuredPrompt.nativeRequested) {
      throw new OpenDynamicWorkflowError(
        ErrorCode.CLI_USAGE_ERROR,
        'Pi does not support structuredOutput.transport="native" yet.'
      );
    }

    const args = [...(this.config.args ?? defaultArgsForMode(executionMode))];

    if (this.config.noSession !== false) args.push("--no-session");
    if (this.config.noContextFiles !== false) args.push("--no-context-files");
    if (this.config.noExtensions !== false) args.push("--no-extensions");
    if (this.config.noSkills !== false) args.push("--no-skills");
    if (this.config.noPromptTemplates !== false) args.push("--no-prompt-templates");
    if (this.config.noThemes !== false) args.push("--no-themes");

    const approvalMode = this.config.approvalMode ?? "no-approve";
    if (approvalMode === "approve") {
      args.push("--approve");
    } else if (approvalMode === "no-approve") {
      args.push("--no-approve");
    }

    if (this.config.piProvider) {
      args.push(providerFlag, this.config.piProvider);
    }

    const model = input.model ?? this.config.defaultModel ?? undefined;
    appendModelArg(args, model, this.config.modelArg, defaultModelFlag);

    if (input.thinkingEffort !== undefined) {
      assertThinkingEffortSupported("pi", input.thinkingEffort);
      args.push("--thinking", input.thinkingEffort);
    } else if (this.config.thinking) {
      args.push("--thinking", this.config.thinking);
    }
    if (this.config.systemPrompt) {
      args.push("--system-prompt", this.config.systemPrompt);
    }
    if (this.config.appendSystemPrompt) {
      args.push("--append-system-prompt", this.config.appendSystemPrompt);
    }

    const isFullAccess = input.permissions?.mode === "dangerously-full-access";
    const tools = isFullAccess
      ? (this.config.fullAccessTools ?? ["read", "bash", "edit", "write", "grep", "find", "ls"])
      : (this.config.safeTools ?? ["read", "grep", "find", "ls"]);
    
    if (tools.length > 0) {
      args.push("--tools", tools.join(","));
    }

    let stdin: string | undefined;
    if (promptMode === "stdin") {
      stdin = structuredPrompt.prompt;
    } else {
      args.push(structuredPrompt.prompt);
    }

    const env = filterAndAugmentEnv(input.env, this.config);

    const cmd: ProviderCommand = {
      command,
      args,
      cwd: input.cwd,
      env
    };

    if (stdin !== undefined) {
      cmd.stdin = stdin;
    }

    return cmd;
  }

  async parseResult(input: ProviderParseInput): Promise<ProviderParsedResult> {
    const executionMode = this.config.executionMode ?? "json";
    if (executionMode === "print") {
      return parsePrintResult(input);
    }
    return parseJsonEventStreamResult(input);
  }
}

function defaultArgsForMode(mode: PiExecutionMode): string[] {
  return mode === "json" ? ["--mode", "json"] : ["--print"];
}

function filterAndAugmentEnv(
  inputEnv: Record<string, string> | undefined,
  config: PiCodingAgentProviderConfig
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(inputEnv ?? {})) {
    if (!shouldRedactEnvName(key)) {
      env[key] = value;
    }
  }
  if (config.deterministicEnv !== false) {
    env.PI_SKIP_VERSION_CHECK ??= "1";
    env.PI_TELEMETRY ??= "0";
  }
  return env;
}

function parsePrintResult(input: ProviderParseInput): ProviderParsedResult {
  const trimmed = input.stdout.trim();
  if (!trimmed) {
    return {
      text: "",
      parseWarnings: ["Empty stdout"]
    };
  }
  const extracted = extractJson(trimmed);
  const result: ProviderParsedResult = {
    text: input.stdout
  };
  if (extracted.ok) {
    result.structuredJson = extracted.value;
  }
  return result;
}

function parseJsonEventStreamResult(input: ProviderParseInput): ProviderParsedResult {
  const stdout = input.stdout.trim();
  if (!stdout) {
    return {
      text: "",
      parseWarnings: ["Empty stdout"]
    };
  }

  const events: unknown[] = [];
  const malformedLines: string[] = [];
  const parseWarnings: string[] = [];

  const lines = input.stdout.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    if (rawLine === undefined) continue;
    const line = rawLine.trim();
    if (!line) continue;

    try {
      events.push(JSON.parse(line));
    } catch (err) {
      malformedLines.push(line);
      parseWarnings.push(`Line ${i + 1} is malformed JSON: ${(err as Error).message}`);
    }
  }

  let finalText: string | undefined;
  
  // Strategy 1: Last assistant message in agent_end.messages or agent_end.message
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i] as any;
    if (event && event.type === "agent_end") {
      if (Array.isArray(event.messages)) {
        const messages = event.messages;
        for (let j = messages.length - 1; j >= 0; j--) {
          const msg = messages[j];
          if (msg && msg.role === "assistant") {
            finalText = extractPiMessageText(msg);
            if (finalText) break;
          }
        }
      } else if (event.message && event.message.role === "assistant") {
        finalText = extractPiMessageText(event.message);
      }
    }
    if (finalText) break;
  }

  // Strategy 2: Last turn_end.message
  if (!finalText) {
    for (let i = events.length - 1; i >= 0; i--) {
      const event = events[i] as any;
      if (event && event.type === "turn_end" && event.message && event.message.role === "assistant") {
        finalText = extractPiMessageText(event.message);
        if (finalText) break;
      }
    }
  }

  // Strategy 3: Last message_end.message
  if (!finalText) {
    for (let i = events.length - 1; i >= 0; i--) {
      const event = events[i] as any;
      if (event && event.type === "message_end" && event.message && event.message.role === "assistant") {
        finalText = extractPiMessageText(event.message);
        if (finalText) break;
      }
    }
  }

  // Strategy 4: Accumulated message_update
  if (!finalText) {
    const parts: string[] = [];
    for (const event of events) {
      const e = event as any;
      if (e?.type === "message_update") {
        let part: string | undefined;
        if (typeof e.text === "string") {
          part = e.text;
        } else if (typeof e.delta === "string") {
          part = e.delta;
        } else if (e.delta && typeof e.delta === "object") {
          part = extractPiMessageText(e.delta);
        } else if (e.content && (typeof e.content === "string" || typeof e.content === "object" || Array.isArray(e.content))) {
          part = extractPiMessageText(e);
        }
        
        if (part) parts.push(part);
      }
    }
    if (parts.length > 0) {
      finalText = parts.join("");
    }
  }

  if (!finalText) {
    parseWarnings.push("Could not identify final assistant message in Pi JSON event stream");
    const res: ProviderParsedResult = {
      text: input.stdout,
      raw: {
        format: "pi-json-events",
        mode: "json",
        events,
        malformedLines
      }
    };
    if (parseWarnings.length > 0) {
      res.parseWarnings = parseWarnings;
    }
    return res;
  }

  const extracted = extractJson(finalText);

  const result: ProviderParsedResult = {
    text: finalText,
    raw: {
      format: "pi-json-events",
      mode: "json",
      events,
      malformedLines
    }
  };
  if (extracted.ok) {
    result.structuredJson = extracted.value;
  }
  if (parseWarnings.length > 0) {
    result.parseWarnings = parseWarnings;
  }
  return result;
}

function extractPiMessageText(message: unknown): string | undefined {
  if (!message || typeof message !== "object" || Array.isArray(message)) return undefined;
  const msg = message as Record<string, unknown>;
  if (typeof msg.text === "string") return msg.text;
  if (typeof msg.content === "string") return msg.content;
  if (Array.isArray(msg.content)) {
    const parts: string[] = [];
    for (const part of msg.content) {
      if (typeof part === "string") parts.push(part);
      if (part && typeof part === "object" && !Array.isArray(part)) {
        const record = part as Record<string, unknown>;
        if (typeof record.text === "string") parts.push(record.text);
        if (typeof record.delta === "string") parts.push(record.delta);
      }
    }
    return parts.join("") || undefined;
  }
  return undefined;
}
