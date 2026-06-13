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

export interface OpenCodeProviderConfig extends ProviderConfig {
  modelFlag?: string;
  agentFlag?: string;
  dirFlag?: string | false;
  formatFlag?: string;
  format?: string;
  variantFlag?: string;
  defaultAgent?: string;
  defaultVariant?: string;
  dangerouslySkipPermissionsFlag?: string;
  permissionPolicy?: "read-only" | "passthrough";
  promptMode?: "arg" | "stdin";
}

export class OpenCodeCliAdapter implements AgentAdapter {
  readonly name = "opencode";
  private readonly config: OpenCodeProviderConfig;

  constructor(config?: OpenCodeProviderConfig) {
    this.config = config ?? { command: "opencode" };
  }

  async checkHealth(): Promise<ProviderHealth> {
    const command = this.config.command ?? "opencode";
    try {
      await runProcess({
        command,
        args: ["--help"],
        cwd: process.cwd(),
        timeoutMs: 2000
      });
      return {
        provider: "opencode",
        available: true,
        command,
        supportsModelSelection: this.config.modelArg !== false
      };
    } catch (err) {
      return {
        provider: "opencode",
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
    const config = this.config;
    const command = config.command ?? "opencode";
    const args = [...(config.args ?? ["run", config.formatFlag ?? "--format", config.format ?? "json"])];

    const structuredPrompt = resolveStructuredOutputPrompt({
      prompt: input.prompt,
      schema: input.schema,
      structuredOutput: input.structuredOutput
    });

    if (structuredPrompt.nativeRequested) {
      throw new OpenFlowError(
        ErrorCode.CLI_USAGE_ERROR,
        'OpenCode does not support structuredOutput.transport="native" yet.'
      );
    }

    if (config.promptMode === "stdin") {
      throw new OpenFlowError(
        ErrorCode.CLI_USAGE_ERROR,
        'OpenCode does not support promptMode="stdin". Use "arg".'
      );
    }

    if (config.dirFlag !== false) {
      args.push(config.dirFlag ?? "--dir", input.cwd);
    }

    appendModelArg(
      args,
      input.model ?? config.defaultModel ?? undefined,
      config.modelArg,
      config.modelFlag ?? "--model"
    );

    const agent = getStringMetadata(input, "opencodeAgent") ?? config.defaultAgent;
    if (agent) {
      args.push(config.agentFlag ?? "--agent", agent);
    }

    const variant = getStringMetadata(input, "opencodeVariant") ?? config.defaultVariant;
    if (variant) {
      args.push(config.variantFlag ?? "--variant", variant);
    }

    const isDangerous = input.permissions?.mode === "dangerously-full-access";
    if (isDangerous) {
      args.push(config.dangerouslySkipPermissionsFlag ?? "--dangerously-skip-permissions");
    }

    args.push(structuredPrompt.prompt);

    const permissionPolicy = config.permissionPolicy ?? "read-only";
    const env = buildFilteredEnv(input.env, {
      permissionPolicy,
      dangerous: isDangerous
    });

    return {
      command,
      args,
      cwd: input.cwd,
      env
    };
  }

  async parseResult(input: ProviderParseInput): Promise<ProviderParsedResult> {
    const stdout = input.stdout.trim();
    if (!stdout) {
      return {
        text: "",
        parseWarnings: ["Empty stdout"]
      };
    }

    // Try whole stdout JSON.parse() first
    try {
      const parsed = JSON.parse(stdout);
      if (parsed && typeof parsed === "object") {
        const text = extractAssistantTextFromEvent(parsed) ?? extractFinalStringFieldFallback(parsed);

        if (text !== undefined) {
          const structured = tryParseEmbeddedJson(text);
          return {
            text,
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
    } catch {
      // JSON.parse failed, try JSONL
    }

    const lines = stdout.split(/\r?\n/).filter(line => line.trim() !== "");
    if (lines.length > 0) {
      const events: any[] = [];
      const warnings: string[] = [];
      let parsedCount = 0;

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]!;
        try {
          events.push(JSON.parse(line));
          parsedCount++;
        } catch (err) {
          warnings.push(`Line ${i + 1} is malformed JSON: ${(err as Error).message}`);
        }
      }

      if (parsedCount > 0) {
        let selectedMessageText: string | undefined;
        let selectedEventIndex: number | undefined;

        // Cautious heuristics to find assistant text
        for (let i = events.length - 1; i >= 0; i--) {
          const text = extractAssistantTextFromEvent(events[i]);
          if (text !== undefined) {
            selectedMessageText = text;
            selectedEventIndex = i;
            break;
          }
        }

        // Fallback to the final non-empty string field named text, content, message, output, or result
        if (selectedMessageText === undefined) {
          for (let i = events.length - 1; i >= 0; i--) {
            const text = extractFinalStringFieldFallback(events[i]);
            if (text !== undefined && text.trim() !== "") {
              selectedMessageText = text;
              selectedEventIndex = i;
              break;
            }
          }
        }

        const result: ProviderParsedResult = {
          raw: {
            format: "opencode-json-events",
            events,
            selectedEventIndex,
            selectedMessageText
          }
        };

        if (selectedMessageText !== undefined) {
          result.text = selectedMessageText;
          result.structuredJson = tryParseEmbeddedJson(selectedMessageText);
        } else {
          result.text = input.stdout;
          warnings.push("No assistant message text found in JSONL stream");
        }

        if (warnings.length > 0) {
          result.parseWarnings = warnings;
        }

        return result;
      }
    }

    // Fallback to plain text
    return {
      text: input.stdout,
      parseWarnings: [`Malformed JSON: Unexpected token ${stdout[0]} in JSON at position 0`]
    };
  }
}

function extractAssistantTextFromEvent(event: any): string | undefined {
  if (!event || typeof event !== "object") return undefined;

  // 1. event.message.role === "assistant" && typeof event.message.content === "string"
  if (
    event.message &&
    typeof event.message === "object" &&
    event.message.role === "assistant" &&
    typeof event.message.content === "string"
  ) {
    return event.message.content;
  }

  // 2. event.role === "assistant" && typeof event.content === "string"
  if (event.role === "assistant" && typeof event.content === "string") {
    return event.content;
  }

  // 3. event.type includes message or assistant and one of text, content, message, output, result is a string
  const type = String(event.type || "").toLowerCase();
  if (type.includes("message") || type.includes("assistant")) {
    const candidate = extractFinalStringFieldFallback(event);
    if (candidate !== undefined) return candidate;
  }

  return undefined;
}

function extractFinalStringFieldFallback(event: any): string | undefined {
  if (!event || typeof event !== "object") return undefined;
  return typeof event.text === "string" ? event.text :
    typeof event.content === "string" ? event.content :
    typeof event.message === "string" ? event.message :
    typeof event.output === "string" ? event.output :
    typeof event.result === "string" ? event.result :
    undefined;
}

function getStringMetadata(input: AgentRunInput, key: string): string | undefined {
  const value = input.metadata?.[key];
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

function buildFilteredEnv(
  inputEnv: Record<string, string> | undefined,
  options: { permissionPolicy: "read-only" | "passthrough"; dangerous: boolean }
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(inputEnv ?? {})) {
    if (!shouldRedactEnvName(key)) env[key] = value;
  }

  if (options.permissionPolicy === "read-only" && !options.dangerous) {
    env.OPENCODE_CONFIG_CONTENT ??= JSON.stringify({
      permission: {
        edit: "deny",
        bash: "deny",
        external_directory: "deny"
      }
    });
  }

  return env;
}

function tryParseEmbeddedJson(text: string): unknown | undefined {
  const extracted = extractJson(text);
  return extracted.ok ? extracted.value : undefined;
}
