import fs from "node:fs/promises";
import ts from "typescript";
import AjvModule from "ajv";
import { 
  CandidateFile, 
  ListDiagnostic, 
  ListedTool 
} from "../discovery/types.js";
import { parseSourceFile, extractStaticValue } from "../discovery/static-values.js";
import { findDefaultDefineCall } from "../discovery/definition-call.js";
import { asStaticObject, deriveRequiredInputs, isPositiveInteger } from "../discovery/schema-summary.js";
import { listDiagnostic } from "../discovery/diagnostics.js";
import { isJsonCompatible, isSafeToolDefinitionId } from "./validate.js";

const Ajv = (AjvModule as any).default || AjvModule;
const ajv = new Ajv({ allErrors: true });

export interface StaticToolContract {
  id: string;
  description: string;
  inputSchema: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  defaultTimeoutMs?: number;
  metadata?: Record<string, unknown>;
}

export type StaticToolContractValidationResult =
  | { ok: true; contract: StaticToolContract; resource: ListedTool }
  | { ok: false; diagnostics: ListDiagnostic[] };

export async function validateStaticToolContract(
  file: CandidateFile
): Promise<StaticToolContractValidationResult> {
  try {
    const sourceText = await fs.readFile(file.absolutePath, "utf8");
    const sourceFile = parseSourceFile(file.absolutePath, sourceText);
    const definitionObject = findDefaultDefineCall(sourceFile, "defineTool");
    const staticContext = { sourceFile };

    if (!definitionObject) {
      return {
        ok: false,
        diagnostics: [listDiagnostic({
          resourceType: "tool",
          path: file.relativePath,
          code: "TOOL_DEFINITION_MISSING",
          message: "Tool file must default export defineTool({ ... })."
        })]
      };
    }

    const diagnostics: ListDiagnostic[] = [];
    const props: Record<string, ts.Expression> = {};
    let hasRun = false;

    for (const prop of definitionObject.properties) {
      if (ts.isPropertyAssignment(prop)) {
        let name: string | undefined;
        if (ts.isIdentifier(prop.name)) {
          name = prop.name.text;
        } else if (ts.isStringLiteral(prop.name)) {
          name = prop.name.text;
        }

        if (name) {
          props[name] = prop.initializer;
          if (name === "run") hasRun = true;
        } else {
          diagnostics.push(listDiagnostic({
            resourceType: "tool",
            path: file.relativePath,
            code: "TOOL_DEFINITION_INVALID",
            message: "Computed or complex property names are not supported in tool definition."
          }));
        }
      } else if (ts.isShorthandPropertyAssignment(prop)) {
        diagnostics.push(listDiagnostic({
          resourceType: "tool",
          path: file.relativePath,
          code: "TOOL_DEFINITION_INVALID",
          message: `Property "${prop.name.text}" must be a static literal, not a shorthand property.`
        }));
      } else if (ts.isMethodDeclaration(prop)) {
        let name: string | undefined;
        if (ts.isIdentifier(prop.name)) {
          name = prop.name.text;
        } else if (ts.isStringLiteral(prop.name)) {
          name = prop.name.text;
        }
        
        if (name === "run") {
          hasRun = true;
        } else if (name) {
          diagnostics.push(listDiagnostic({
            resourceType: "tool",
            path: file.relativePath,
            code: "TOOL_DEFINITION_INVALID",
            message: `Method "${name}" is not supported in tool metadata.`
          }));
        } else {
          diagnostics.push(listDiagnostic({
            resourceType: "tool",
            path: file.relativePath,
            code: "TOOL_DEFINITION_INVALID",
            message: "Computed or complex method names are not supported in tool definition."
          }));
        }
      } else if (ts.isSpreadAssignment(prop)) {
        diagnostics.push(listDiagnostic({
          resourceType: "tool",
          path: file.relativePath,
          code: "TOOL_DEFINITION_INVALID",
          message: "Spread properties are not supported in tool definition."
        }));
      } else {
        diagnostics.push(listDiagnostic({
          resourceType: "tool",
          path: file.relativePath,
          code: "TOOL_DEFINITION_INVALID",
          message: "Unsupported property definition type."
        }));
      }
    }

    if (!hasRun) {
      diagnostics.push(listDiagnostic({
        resourceType: "tool",
        path: file.relativePath,
        code: "TOOL_DEFINITION_INVALID",
        message: "Tool must have a run method or property."
      }));
    }

    let id = "";
    if (!props.id) {
      diagnostics.push(listDiagnostic({
        resourceType: "tool",
        path: file.relativePath,
        code: "TOOL_DEFINITION_INVALID",
        message: "Tool id must be a static non-empty string."
      }));
    } else {
      const idResult = extractStaticValue(props.id, staticContext);
      if (!idResult.ok || typeof idResult.value !== "string" || idResult.value === "") {
        diagnostics.push(listDiagnostic({
          resourceType: "tool",
          path: file.relativePath,
          code: "TOOL_DEFINITION_INVALID",
          message: "Tool id must be a static non-empty string."
        }));
      } else if (!isSafeToolDefinitionId(idResult.value)) {
        diagnostics.push(listDiagnostic({
          resourceType: "tool",
          path: file.relativePath,
          code: "TOOL_DEFINITION_INVALID",
          message: `Tool id '${idResult.value}' is not safe. Tool IDs must be non-empty and not path-like.`
        }));
      } else {
        id = idResult.value;
      }
    }

    let description = "";
    if (!props.description) {
      diagnostics.push(listDiagnostic({
        resourceType: "tool",
        path: file.relativePath,
        code: "TOOL_DEFINITION_INVALID",
        message: "Tool description must be a static non-empty string."
      }));
    } else {
      const descResult = extractStaticValue(props.description, staticContext);
      if (!descResult.ok || typeof descResult.value !== "string" || descResult.value.trim() === "") {
        diagnostics.push(listDiagnostic({
          resourceType: "tool",
          path: file.relativePath,
          code: "TOOL_DEFINITION_INVALID",
          message: "Tool description must be a static non-empty string."
        }));
      } else {
        description = descResult.value.trim();
      }
    }

    if (diagnostics.length > 0) {
      return { ok: false, diagnostics };
    }

    const tool: ListedTool = {
      type: "tool",
      id,
      description,
      path: file.relativePath,
      valid: true
    };

    let inputSchema: Record<string, unknown>;
    if (Object.prototype.hasOwnProperty.call(props, "inputSchema")) {
      const extractedSchema = asStaticObject(props.inputSchema!, staticContext);
      if (extractedSchema) {
        try {
          ajv.compile(extractedSchema);
          tool.inputSchema = extractedSchema;
          inputSchema = extractedSchema;
          
          const requiredInputs = deriveRequiredInputs(extractedSchema);
          if (requiredInputs !== undefined) {
            tool.requiredInputs = requiredInputs;
          }
        } catch (err: any) {
          return {
            ok: false,
            diagnostics: [listDiagnostic({
              resourceType: "tool",
              path: file.relativePath,
              code: "TOOL_DEFINITION_INVALID",
              message: `Tool inputSchema failed validation: ${err.message}`
            })]
          };
        }
      } else {
        return {
          ok: false,
          diagnostics: [listDiagnostic({
            resourceType: "tool",
            path: file.relativePath,
            code: "TOOL_DEFINITION_INVALID",
            message: "Tool inputSchema must be a static object literal."
          })]
        };
      }
    } else {
      return {
        ok: false,
        diagnostics: [listDiagnostic({
          resourceType: "tool",
          path: file.relativePath,
          code: "TOOL_DEFINITION_INVALID",
          message: "Tool must have an inputSchema."
        })]
      };
    }

    let outputSchema: Record<string, unknown> | undefined;
    if (Object.prototype.hasOwnProperty.call(props, "outputSchema")) {
      const extractedSchema = asStaticObject(props.outputSchema!, staticContext);
      if (extractedSchema) {
        try {
          ajv.compile(extractedSchema);
          tool.outputSchema = extractedSchema;
          outputSchema = extractedSchema;
        } catch (err: any) {
          return {
            ok: false,
            diagnostics: [listDiagnostic({
              resourceType: "tool",
              path: file.relativePath,
              code: "TOOL_DEFINITION_INVALID",
              message: `Tool outputSchema failed validation: ${err.message}`
            })]
          };
        }
      } else {
        return {
          ok: false,
          diagnostics: [listDiagnostic({
            resourceType: "tool",
            path: file.relativePath,
            code: "TOOL_DEFINITION_INVALID",
            message: "Tool outputSchema must be a static object literal."
          })]
        };
      }
    }

    let defaultTimeoutMs: number | undefined;
    if (Object.prototype.hasOwnProperty.call(props, "defaultTimeoutMs")) {
      const timeoutResult = extractStaticValue(props.defaultTimeoutMs!, staticContext);
      if (timeoutResult.ok && isPositiveInteger(timeoutResult.value)) {
        tool.defaultTimeoutMs = timeoutResult.value;
        defaultTimeoutMs = timeoutResult.value;
      } else {
        return {
          ok: false,
          diagnostics: [listDiagnostic({
            resourceType: "tool",
            path: file.relativePath,
            code: "TOOL_DEFINITION_INVALID",
            message: "Tool defaultTimeoutMs must be a static positive integer."
          })]
        };
      }
    }

    let metadata: Record<string, unknown> | undefined;
    if (Object.prototype.hasOwnProperty.call(props, "metadata")) {
      const extractedMetadata = asStaticObject(props.metadata!, staticContext);
      if (extractedMetadata) {
        if (!isJsonCompatible(extractedMetadata)) {
          return {
            ok: false,
            diagnostics: [listDiagnostic({
              resourceType: "tool",
              path: file.relativePath,
              code: "TOOL_DEFINITION_INVALID",
              message: "Tool metadata must be JSON-compatible."
            })]
          };
        }
        metadata = extractedMetadata;
      } else {
        return {
          ok: false,
          diagnostics: [listDiagnostic({
            resourceType: "tool",
            path: file.relativePath,
            code: "TOOL_DEFINITION_INVALID",
            message: "Tool metadata must be a static object literal."
          })]
        };
      }
    }

    const contract: StaticToolContract = {
      id,
      description,
      inputSchema,
      ...(outputSchema !== undefined ? { outputSchema } : {}),
      ...(defaultTimeoutMs !== undefined ? { defaultTimeoutMs } : {}),
      ...(metadata !== undefined ? { metadata } : {}),
    };

    return {
      ok: true,
      contract,
      resource: tool
    };

  } catch (error) {
    return {
      ok: false,
      diagnostics: [listDiagnostic({
        resourceType: "tool",
        path: file.relativePath,
        code: "TOOL_DEFINITION_INVALID",
        message: `Failed to read or parse tool file: ${error instanceof Error ? error.message : String(error)}`
      })]
    };
  }
}
