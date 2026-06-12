import {
  BrandedToolDefinition,
  ToolDefinition,
  TOOL_DEFINITION_MARKER
} from "../types/tool.js";

/**
 * Defines a tool for use in OpenFlow workflows.
 * Brands the definition and freezes it to prevent mutation.
 */
export function defineTool<TInput = unknown, TOutput = unknown>(
  definition: ToolDefinition<TInput, TOutput>
): BrandedToolDefinition<TInput, TOutput> {
  const copy = { ...definition };

  Object.defineProperty(copy, TOOL_DEFINITION_MARKER, {
    value: true,
    enumerable: false,
    configurable: false,
    writable: false
  });

  return Object.freeze(copy) as BrandedToolDefinition<TInput, TOutput>;
}

/**
 * Checks if a value is a branded tool definition.
 */
export function isDefinedTool(value: unknown): value is BrandedToolDefinition {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as any)[TOOL_DEFINITION_MARKER] === true
  );
}
