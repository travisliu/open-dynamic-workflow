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
import { OpenFlowError } from "../errors/types.js";
import { ErrorCode } from "../errors/codes.js";

export interface GitHubCopilotProviderConfig extends Partial<ProviderConfig> {
  promptFlag?: string;
  modelFlag?: string;
  promptMode?: "arg" | "stdin";
  dangerouslySkipPermissionsFlag?: string;
  permissionPolicy?: "restricted" | "passthrough";
}

const DEFAULT_COPILOT_CONFIG: GitHubCopilotProviderConfig = {
  command: "copilot",
  args: ["-s", "--no-ask-user", "--no-auto-update", "--output-format=json"],
  defaultModel: null,
  modelArg: { flag: "--model" },
  promptMode: "arg",
  promptFlag: "-p",
  dangerouslySkipPermissionsFlag: "--yolo",
  permissionPolicy: "restricted"
};

export class GitHubCopilotCliAdapter implements AgentAdapter {
  readonly name = "copilot";
  private readonly config: GitHubCopilotProviderConfig;

  constructor(config?: GitHubCopilotProviderConfig) {
    this.config = { ...DEFAULT_COPILOT_CONFIG, ...(config ?? {}) };
  }

  async checkHealth(): Promise<ProviderHealth> {
    const command = this.config.command ?? "copilot";
    try {
      await runProcess({
        command,
        args: ["--help"],
        cwd: process.cwd(),
        timeoutMs: 2000
      });
      return {
        provider: "copilot",
        available: true,
        command,
        supportsModelSelection: this.config.modelArg !== false
      };
    } catch (err) {
      return {
        provider: "copilot",
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
    const command = this.config.command ?? "copilot";
    const args = [...(this.config.args ?? DEFAULT_COPILOT_CONFIG.args!)];

    const structuredPrompt = resolveStructuredOutputPrompt({
      prompt: input.prompt,
      schema: input.schema,
      structuredOutput: input.structuredOutput
    });

    if (structuredPrompt.nativeRequested) {
      throw new OpenFlowError(
        ErrorCode.CLI_USAGE_ERROR,
        'GitHub Copilot CLI does not support structuredOutput.transport="native" yet.'
      );
    }

    const modelArg = this.config.modelArg === false
      ? false
      : (this.config.modelFlag 
          ? (typeof this.config.modelArg === 'object' ? { ...this.config.modelArg, flag: this.config.modelFlag } : { flag: this.config.modelFlag })
          : this.config.modelArg);

    appendModelArg(
      args,
      input.model ?? this.config.defaultModel ?? undefined,
      modelArg,
      "--model"
    );

    if (input.permissions?.mode === "dangerously-full-access") {
      args.push(this.config.dangerouslySkipPermissionsFlag ?? "--yolo");
    }

    const promptMode = this.config.promptMode ?? "arg";
    let stdin: string | undefined = undefined;

    if (promptMode === "stdin") {
      stdin = structuredPrompt.prompt;
    } else {
      args.push(this.config.promptFlag ?? "-p", structuredPrompt.prompt);
    }

    const filteredEnv = filterProviderEnv(input.env);

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

    // Try JSONL parsing first
    const lines = input.stdout.split("\n");
    const events: any[] = [];
    const parseWarnings: string[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!line || line.trim() === "") continue;

      try {
        events.push(JSON.parse(line));
      } catch {
        const lineNum = i + 1;
        parseWarnings.push(`Malformed JSON line ${lineNum}: ${line.substring(0, 50)}${line.length > 50 ? "..." : ""}`);
      }
    }

    if (events.length > 0) {
      const selection = selectAssistantText(events);
      const res: ProviderParsedResult = {
        text: selection.text ?? input.stdout,
        raw: {
          format: "copilot-jsonl",
          events,
          selectedEventIndex: selection.index,
          selectedMessageText: selection.text
        }
      };

      if (!selection.text) {
        parseWarnings.push("no extractable response text");
      }

      if (parseWarnings.length > 0) {
        res.parseWarnings = parseWarnings;
      }

      // Handle structured output
      if (selection.text) {
        const sj = tryParseEmbeddedJson(selection.text);
        if (sj !== undefined) {
          res.structuredJson = sj;
        }
      }

      if (res.structuredJson === undefined) {
        // Fallback: scan text-like fields from the end of the event stream for embedded JSON
        for (let i = events.length - 1; i >= 0; i--) {
          const eventText = getEventText(events[i]);
          if (eventText) {
            const sj = tryParseEmbeddedJson(eventText);
            if (sj !== undefined) {
              res.structuredJson = sj;
              break;
            }
          }
        }
      }

      // Final fallback for single event JSON
      if (res.structuredJson === undefined && events.length === 1 && !selection.text) {
        res.structuredJson = events[0];
        res.json = events[0];
      }

      return res;
    }

    // Fallback to whole-output JSON.parse()
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed && typeof parsed === "object") {
        const textFields = ["text", "message", "content", "response", "output", "result"];
        let text: string | undefined = undefined;
        for (const field of textFields) {
          if (typeof parsed[field] === "string") {
            text = parsed[field];
            break;
          }
        }

        if (text !== undefined) {
          const res: ProviderParsedResult = {
            text,
            json: parsed,
            raw: parsed
          };
          const sj = tryParseEmbeddedJson(text);
          if (sj !== undefined) {
            res.structuredJson = sj;
          }
          return res;
        }

        return {
          json: parsed,
          structuredJson: parsed,
          raw: parsed
        };
      }
    } catch {
      // Malformed JSON, fall back to plain text
    }

    const result: ProviderParsedResult = {
      text: input.stdout
    };
    const structured = tryParseEmbeddedJson(input.stdout);
    if (structured !== undefined) {
      result.structuredJson = structured;
    }
    result.parseWarnings = ["Malformed JSON: Unexpected token"];
    return result;
  }
}

function filterProviderEnv(inputEnv: Record<string, string> | undefined): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(inputEnv ?? {})) {
    if (!shouldRedactEnvName(key)) env[key] = value;
  }
  return env;
}

function selectAssistantText(events: any[]): { text: string | undefined; index: number } {
  // Prefer events with type/name fields containing assistant, message, response, or result
  const preferredTypes = ["assistant", "message", "response", "result"];
  
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i];
    const type = (event.type || event.name || "").toLowerCase();
    if (preferredTypes.some(t => type.includes(t))) {
      const text = getEventText(event);
      if (text) return { text, index: i };
    }
  }

  // Fallback: use the last non-empty text-like field in the event stream
  for (let i = events.length - 1; i >= 0; i--) {
    const text = getEventText(events[i]);
    if (text) return { text, index: i };
  }

  return { text: undefined, index: -1 };
}

function getEventText(event: any): string | undefined {
  if (!event || typeof event !== "object") return undefined;

  const fields = ["text", "message", "content", "response", "output", "result"];
  for (const field of fields) {
    if (typeof event[field] === "string") return event[field];
  }

  // Nested fields
  if (event.message && typeof event.message.content === "string") return event.message.content;
  if (event.item && typeof event.item.text === "string") return event.item.text;
  if (event.item && typeof event.item.content === "string") return event.item.content;

  return undefined;
}

function tryParseEmbeddedJson(text: string): unknown | undefined {
  const extracted = extractJson(text);
  return extracted.ok ? extracted.value : undefined;
}
