import AjvModule from "ajv";
import {
  BrandedToolDefinition,
  RegisteredToolDefinition,
  ToolRegistry,
  ToolValidationResult
} from "../types/tool.js";
import {
  formatAjvErrors,
  isJsonCompatible,
  isSafeToolDefinitionId
} from "./validate.js";
import { OpenFlowError } from "../errors/types.js";

const Ajv = (AjvModule as any).default || AjvModule;
const ajv = new Ajv({ allErrors: true });

export interface BuildToolRegistryInput {
  definitions: Array<{ definition: BrandedToolDefinition; sourcePath: string }>;
  maxDefinitions: number;
}

export function buildToolRegistry(input: BuildToolRegistryInput): ToolRegistry {
  const { definitions, maxDefinitions } = input;

  if (definitions.length > maxDefinitions) {
    throw new OpenFlowError(
      "TOOL_INVALID_DEFINITION" as any,
      `Too many tool definitions. Maximum allowed is ${maxDefinitions}.`
    );
  }

  const registered: RegisteredToolDefinition[] = [];
  const ids = new Map<string, string>(); // id -> sourcePath

  for (const { definition, sourcePath } of definitions) {
    // 1. Basic validation
    if (!isSafeToolDefinitionId(definition.id)) {
      throw new OpenFlowError(
        "TOOL_INVALID_DEFINITION" as any,
        `Invalid tool ID '${definition.id}' in ${sourcePath}. Tool IDs must be non-empty and not path-like.`
      );
    }

    if (ids.has(definition.id)) {
      throw new OpenFlowError(
        "TOOL_DUPLICATE_DEFINITION" as any,
        `Duplicate tool ID '${definition.id}' detected. Found in:\n  - ${ids.get(definition.id)}\n  - ${sourcePath}`
      );
    }
    ids.set(definition.id, sourcePath);

    if (!definition.description || typeof definition.description !== "string") {
      throw new OpenFlowError(
        "TOOL_INVALID_DEFINITION" as any,
        `Tool '${definition.id}' in ${sourcePath} is missing a description.`
      );
    }

    if (!definition.inputSchema) {
      throw new OpenFlowError(
        "TOOL_INVALID_DEFINITION" as any,
        `Tool '${definition.id}' in ${sourcePath} is missing 'inputSchema'.`
      );
    }

    if (typeof definition.run !== "function") {
      throw new OpenFlowError(
        "TOOL_INVALID_DEFINITION" as any,
        `Tool '${definition.id}' in ${sourcePath} is missing a 'run' function.`
      );
    }

    if (definition.defaultTimeoutMs !== undefined) {
      if (!Number.isInteger(definition.defaultTimeoutMs) || definition.defaultTimeoutMs <= 0) {
        throw new OpenFlowError(
          "TOOL_INVALID_DEFINITION" as any,
          `Tool '${definition.id}' in ${sourcePath} has an invalid 'defaultTimeoutMs'. It must be a positive integer.`
        );
      }
    }

    if (definition.metadata !== undefined) {
      if (!isJsonCompatible(definition.metadata)) {
        throw new OpenFlowError(
          "TOOL_INVALID_DEFINITION" as any,
          `Tool '${definition.id}' in ${sourcePath} has metadata that is not JSON-compatible.`
        );
      }
    }

    // 2. Schema compilation
    let validateInput: (data: unknown) => ToolValidationResult;
    try {
      const ajvValidate = ajv.compile(definition.inputSchema);
      validateInput = (data: unknown) => {
        const ok = ajvValidate(data);
        if (ok) return { ok: true, value: data };
        return { ok: false, errors: formatAjvErrors(ajvValidate.errors) };
      };
    } catch (err: any) {
      throw new OpenFlowError(
        "TOOL_INVALID_DEFINITION" as any,
        `Tool '${definition.id}' in ${sourcePath} has an invalid 'inputSchema': ${err.message}`
      );
    }

    let validateOutput: (data: unknown) => ToolValidationResult;
    if (definition.outputSchema) {
      try {
        const ajvValidate = ajv.compile(definition.outputSchema);
        validateOutput = (data: unknown) => {
          const ok = ajvValidate(data);
          if (ok) return { ok: true, value: data };
          return { ok: false, errors: formatAjvErrors(ajvValidate.errors) };
        };
      } catch (err: any) {
        throw new OpenFlowError(
          "TOOL_INVALID_DEFINITION" as any,
          `Tool '${definition.id}' in ${sourcePath} has an invalid 'outputSchema': ${err.message}`
        );
      }
    } else {
      validateOutput = (data: unknown) => ({ ok: true, value: data });
    }

    registered.push(Object.freeze({
      definition,
      sourcePath,
      validateInput,
      validateOutput
    }));
  }

  const toolsMap = new Map<string, RegisteredToolDefinition>();
  for (const def of registered) {
    toolsMap.set(def.definition.id, def);
  }

  return Object.freeze({
    get: (id: string) => toolsMap.get(id),
    require: (id: string) => {
      const tool = toolsMap.get(id);
      if (!tool) {
        throw new OpenFlowError(
          "TOOL_DEFINITION_NOT_FOUND" as any,
          `Tool definition '${id}' not found in registry.`
        );
      }
      return tool;
    },
    has: (id: string) => toolsMap.has(id),
    list: () => Array.from(toolsMap.values())
  });
}
