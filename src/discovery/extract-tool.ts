import fs from "node:fs/promises";
import ts from "typescript";
import { 
  CandidateFile, 
  ResourceExtractionResult, 
  ListedTool, 
  ListDiagnostic 
} from "./types.js";
import { parseSourceFile, extractStaticValue } from "./static-values.js";
import { findDefaultDefineCall } from "./definition-call.js";
import { asStaticObject, deriveRequiredInputs, isPositiveInteger } from "./schema-summary.js";
import { listDiagnostic } from "./diagnostics.js";

export async function extractTool(file: CandidateFile): Promise<ResourceExtractionResult> {
  try {
    const sourceText = await fs.readFile(file.absolutePath, "utf8");
    const sourceFile = parseSourceFile(file.absolutePath, sourceText);
    const definitionObject = findDefaultDefineCall(sourceFile, "defineTool");

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
        }
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

    const idResult = props.id ? extractStaticValue(props.id) : undefined;
    const descResult = props.description ? extractStaticValue(props.description) : undefined;

    const id = idResult?.ok && typeof idResult.value === "string" ? idResult.value.trim() : "";
    const description = descResult?.ok && typeof descResult.value === "string" ? descResult.value.trim() : "";

    if (!props.id || !id) {
      diagnostics.push(listDiagnostic({
        resourceType: "tool",
        path: file.relativePath,
        code: "TOOL_DEFINITION_INVALID",
        message: "Tool id must be a static non-empty string."
      }));
    }

    if (!props.description || !description) {
      diagnostics.push(listDiagnostic({
        resourceType: "tool",
        path: file.relativePath,
        code: "TOOL_DEFINITION_INVALID",
        message: "Tool description must be a static non-empty string."
      }));
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

    if (Object.prototype.hasOwnProperty.call(props, "inputSchema")) {
      const inputSchema = asStaticObject(props.inputSchema!);
      if (inputSchema) {
        tool.inputSchema = inputSchema;
        const requiredInputs = deriveRequiredInputs(inputSchema);
        if (requiredInputs !== undefined) {
          tool.requiredInputs = requiredInputs;
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

    if (Object.prototype.hasOwnProperty.call(props, "outputSchema")) {
      const outputSchema = asStaticObject(props.outputSchema!);
      if (outputSchema) {
        tool.outputSchema = outputSchema;
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

    if (Object.prototype.hasOwnProperty.call(props, "defaultTimeoutMs")) {
      const timeoutResult = extractStaticValue(props.defaultTimeoutMs!);
      if (timeoutResult.ok && isPositiveInteger(timeoutResult.value)) {
        tool.defaultTimeoutMs = timeoutResult.value;
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

    return { ok: true, resource: tool };

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
