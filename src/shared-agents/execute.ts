import { ErrorCode } from "../errors/codes.js";
import { OpenFlowError } from "../errors/types.js";
import type { DirectAgentCallInput, AgentResult } from "../types/agent.js";
import type { ResolvedConfig } from "../types/config.js";
import { sanitizeMetadata } from "../security/metadata.js";
import { normalizeSharedAgentContext } from "./context.js";
import { withToolForbidden } from "../workflow/scope.js";
import type { SharedAgentRegistry } from "./registry.js";
import { renderAgentPrompt } from "./render.js";
import { resolveSharedAgent } from "./resolver.js";
import type {
  SharedAgentPipelineMetadata,
  SharedAgentRuntime,
} from "./types.js";

export interface ExecuteSharedAgentInput {
  sharedAgentId: string;
  context?: unknown;
  origin: "workflow" | "pipeline-stage";
  pipeline?: SharedAgentPipelineMetadata | undefined;
}

export interface ExecuteSharedAgentDeps {
  registry: SharedAgentRegistry;
  config: ResolvedConfig;
  runId: string;
  cwd: string;
  signal: AbortSignal;
  agent(input: DirectAgentCallInput): Promise<AgentResult>;
  log(message: string, data?: unknown): void;
  artifactsDir: string;
}

/**
 * Executes a shared agent by resolving it, validating context, and executing its run() method.
 */
export async function executeSharedAgent(
  input: ExecuteSharedAgentInput,
  deps: ExecuteSharedAgentDeps
): Promise<AgentResult> {
  const entry = resolveSharedAgent(deps.registry, input.sharedAgentId);
  const { definition } = entry;

  const context = normalizeSharedAgentContext(definition, input.context);

  const runtimeObj: SharedAgentRuntime = {
    agent: (innerInput) => {
      const enrichedInput: DirectAgentCallInput = {
        ...innerInput,
        label: innerInput.label || entry.id,
        metadata: {
          ...sanitizeMetadata(definition.metadata || {}),
          ...innerInput.metadata,
          sharedAgentId: entry.id,
          sharedAgentSource: "registry",
          ...(input.pipeline ?? {}),
        }
      };
      return deps.agent(enrichedInput);
    },
    log: deps.log,
    signal: deps.signal,
    runId: deps.runId,
    cwd: deps.cwd,
    artifactsDir: deps.artifactsDir,
    renderAgentPrompt: (customContext: unknown) => {
      if (!("agentPrompt" in definition) || typeof definition.agentPrompt !== "string") {
        throw new OpenFlowError(
          ErrorCode.SHARED_AGENT_PROMPT_RENDER_FAILED,
          "Cannot render agent prompt because 'agentPrompt' is not defined in this shared agent."
        );
      }
      if (!customContext || typeof customContext !== "object") {
        throw new OpenFlowError(
          ErrorCode.SHARED_AGENT_PROMPT_RENDER_FAILED,
          "Context passed to renderAgentPrompt must be an object."
        );
      }
      const declaredFields = new Set(
        Object.keys(definition.inputSchema?.properties || {})
      );
      return renderAgentPrompt({
        agentPrompt: definition.agentPrompt,
        context: customContext as Record<string, unknown>,
        declaredFields,
        strictVariables: deps.config.sharedAgents?.strictPromptTemplateVariables ?? true,
      });
    }
  };
  if (input.pipeline !== undefined) {
    runtimeObj.pipeline = input.pipeline;
  }

  try {
    return await withToolForbidden("shared-agent-definition", async () => {
      return await definition.run(context, runtimeObj);
    });
  } catch (err: any) {
    throw new OpenFlowError(
      ErrorCode.SHARED_AGENT_RUNTIME_FAILED,
      `Shared agent '${entry.id}' runtime execution failed: ${err.message}`,
      { cause: err }
    );
  }
}

