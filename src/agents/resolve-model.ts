export interface ResolveModelInput {
  agentModel?: string | undefined;
  cliModel?: string | undefined;
  providerDefaultModel?: string | null | undefined;
  globalDefaultModel?: string | null | undefined;
}

export interface ResolvedModel {
  model?: string;
  source: "agent" | "cli" | "provider-config" | "global-config" | "provider-default";
}

export function resolveAgentModel(input: ResolveModelInput): ResolvedModel {
  if (input.agentModel !== undefined) {
    return {
      model: input.agentModel,
      source: "agent"
    };
  }

  if (input.cliModel !== undefined && input.cliModel.trim() !== "") {
    return {
      model: input.cliModel,
      source: "cli"
    };
  }

  if (input.providerDefaultModel !== undefined && input.providerDefaultModel !== null) {
    return {
      model: input.providerDefaultModel,
      source: "provider-config"
    };
  }

  if (input.globalDefaultModel !== undefined && input.globalDefaultModel !== null) {
    return {
      model: input.globalDefaultModel,
      source: "global-config"
    };
  }

  return {
    source: "provider-default"
  };
}
