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

  async buildCommand(input: AgentRunInput): Promise<ProviderCommand> {
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
