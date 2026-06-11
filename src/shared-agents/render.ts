import { ErrorCode } from "../errors/codes.js";
import { OpenFlowError } from "../errors/types.js";

export interface RenderAgentPromptInput {
  agentPrompt: string;
  context: Record<string, unknown>;
  declaredFields: Set<string>;
  strictVariables: boolean;
}

/**
 * Renders a declarative agentPrompt template by interpolating variables from context.
 * Supports only simple {{name}} interpolation.
 */
export function renderAgentPrompt(input: RenderAgentPromptInput): string {
  const rendered = input.agentPrompt.replace(
    /\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g,
    (_match, key) => {
      if (!input.declaredFields.has(key)) {
        throw new OpenFlowError(
          ErrorCode.SHARED_AGENT_UNDECLARED_PROMPT_VARIABLE,
          `agentPrompt references undeclared context field '${key}'.`
        );
      }
      const value = input.context[key];
      if (value === undefined) {
        if (input.strictVariables) {
          throw new OpenFlowError(
            ErrorCode.SHARED_AGENT_PROMPT_RENDER_FAILED,
            `agentPrompt variable '${key}' was not provided.`
          );
        }
        return "";
      }
      return typeof value === "string" ? value : JSON.stringify(value);
    }
  );

  // Reject unclosed tokens or expression-like templates by checking the template structure (excluding valid tokens)
  const templateWithoutValidTokens = input.agentPrompt.replace(
    /\{\{\s*[A-Za-z_][A-Za-z0-9_]*\s*\}\}/g,
    ""
  );
  if (templateWithoutValidTokens.includes("{{") || templateWithoutValidTokens.includes("}}")) {
    throw new OpenFlowError(
      ErrorCode.SHARED_AGENT_PROMPT_RENDER_FAILED,
      "agentPrompt contains unclosed tokens or unsupported expression-like templates."
    );
  }

  if (rendered.trim() === "") {
    throw new OpenFlowError(
      ErrorCode.SHARED_AGENT_PROMPT_RENDER_FAILED,
      "Rendered prompt must be non-empty."
    );
  }

  return rendered;
}
