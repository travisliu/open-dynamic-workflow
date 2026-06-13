import type {
  AgentAdapter,
  ProviderHealth,
  AgentRunInput,
  ProviderCommand,
  ProviderParseInput,
  ProviderParsedResult,
  MockProviderConfig,
  MockProviderResponse
} from "./types.js";
import { resolveStructuredOutputPrompt } from "../structured/structured-output.js";
import { OpenFlowError } from "../errors/types.js";
import { ErrorCode } from "../errors/codes.js";

export class MockAdapter implements AgentAdapter {
  readonly name = "mock";
  private readonly config: MockProviderConfig;

  constructor(config?: MockProviderConfig) {
    this.config = config ?? {};
  }

  async checkHealth(): Promise<ProviderHealth> {
    return {
      provider: "mock",
      available: true,
      supportsModelSelection: true
    };
  }

  capabilities() {
    return {
      prompt: {
        transports: ["stdin" as const]
      },
      output: {
        formats: ["text" as const, "json" as const]
      },
      structuredOutput: {
        modes: ["prompt" as const, "validate-only" as const]
      },
      usage: {
        source: "none" as const
      },
      sessions: {
        modes: ["none" as const]
      },
      permissions: {
        modes: ["none" as const]
      }
    };
  }

  async buildCommand(input: AgentRunInput): Promise<ProviderCommand> {
    const structuredPrompt = resolveStructuredOutputPrompt({
      prompt: input.prompt,
      schema: input.schema,
      structuredOutput: input.structuredOutput
    });
    if (structuredPrompt.nativeRequested) {
      throw new OpenFlowError(
        ErrorCode.CLI_USAGE_ERROR,
        'Mock provider does not support structuredOutput.transport="native" yet.'
      );
    }
    return {
      command: "mock-process",
      args: [input.id],
      cwd: input.cwd,
      env: {}
    };
  }

  async parseResult(input: ProviderParseInput): Promise<ProviderParsedResult & { model?: string }> {
    const response = this.lookupResponse(input.input);
    const result: ProviderParsedResult & { model?: string } = {};
    if (response.json !== undefined) {
      result.json = response.json;
      result.text = response.text ?? (typeof response.json === "string" ? response.json : JSON.stringify(response.json));
    } else {
      result.text = response.text ?? "mock response";
    }
    if (input.input.model !== undefined) {
      result.model = input.input.model;
    }
    if (response.usage !== undefined) {
      result.usage = response.usage;
    }
    if (response.providerSessionId !== undefined) {
      result.providerSessionId = response.providerSessionId;
    }
    if (response.providerThreadId !== undefined) {
      result.providerThreadId = response.providerThreadId;
    }
    if (response.providerMetadata !== undefined) {
      result.providerMetadata = response.providerMetadata;
    }
    if (response.failure !== undefined) {
      result.failure = response.failure;
    }
    return result;
  }

  lookupResponse(input: AgentRunInput): MockProviderResponse {
    const responses = this.config.responses ?? {};
    const idResponse = responses[input.id];
    if (idResponse) {
      return idResponse;
    }
    if (input.label) {
      const labelResponse = responses[input.label];
      if (labelResponse) {
        return labelResponse;
      }
    }
    if (this.config.defaultResponse) {
      return this.config.defaultResponse;
    }
    return { text: "mock response" };
  }
}
