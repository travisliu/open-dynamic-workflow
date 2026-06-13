import fs from "node:fs/promises";
import ts from "typescript";
import { 
  CandidateFile, 
  ResourceExtractionResult, 
  ListedAgent, 
  ListDiagnostic 
} from "./types.js";
import { parseSourceFile, extractStaticValue } from "./static-values.js";
import { findDefaultDefineCall } from "./definition-call.js";
import { asStaticObject, deriveRequiredInputs } from "./schema-summary.js";
import { listDiagnostic } from "./diagnostics.js";

export async function extractAgent(file: CandidateFile): Promise<ResourceExtractionResult> {
  try {
    const sourceText = await fs.readFile(file.absolutePath, "utf8");
    const sourceFile = parseSourceFile(file.absolutePath, sourceText);
    const definitionObject = findDefaultDefineCall(sourceFile, "defineAgent");

    if (!definitionObject) {
      return {
        ok: false,
        diagnostics: [listDiagnostic({
          resourceType: "agent",
          path: file.relativePath,
          code: "AGENT_DEFINITION_MISSING",
          message: "Shared agent file must default export defineAgent({ ... })."
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
        // Shorthand properties are dynamic in this context (requires looking up variable)
        diagnostics.push(listDiagnostic({
          resourceType: "agent",
          path: file.relativePath,
          code: "AGENT_DEFINITION_INVALID",
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
            resourceType: "agent",
            path: file.relativePath,
            code: "AGENT_DEFINITION_INVALID",
            message: `Method "${name}" is not supported in agent metadata.`
          }));
        }
      }
    }

    if (!hasRun) {
      diagnostics.push(listDiagnostic({
        resourceType: "agent",
        path: file.relativePath,
        code: "AGENT_DEFINITION_INVALID",
        message: "Agent must have a run method or property."
      }));
    }

    const idResult = props.id ? extractStaticValue(props.id) : undefined;
    const id = idResult?.ok && typeof idResult.value === "string" ? idResult.value.trim() : "";

    if (!props.id || !id) {
      diagnostics.push(listDiagnostic({
        resourceType: "agent",
        path: file.relativePath,
        code: "AGENT_DEFINITION_INVALID",
        message: "Agent id must be a static non-empty string."
      }));
    }

    let description = "";
    if (props.description) {
      const descResult = extractStaticValue(props.description);
      if (descResult.ok && typeof descResult.value === "string") {
        description = descResult.value.trim();
      } else {
        diagnostics.push(listDiagnostic({
          resourceType: "agent",
          path: file.relativePath,
          code: "AGENT_DEFINITION_INVALID",
          message: "Agent description must be a static string."
        }));
      }
    }

    if (diagnostics.length > 0) {
      return { ok: false, diagnostics };
    }

    const agent: ListedAgent = {
      type: "agent",
      id,
      description,
      path: file.relativePath,
      valid: true
    };

    if (Object.prototype.hasOwnProperty.call(props, "metadata")) {
      const metadata = asStaticObject(props.metadata!);
      if (metadata) {
        agent.metadata = metadata;
      } else {
        return {
          ok: false,
          diagnostics: [listDiagnostic({
            resourceType: "agent",
            path: file.relativePath,
            code: "AGENT_DEFINITION_INVALID",
            message: "Agent metadata must be a static object literal."
          })]
        };
      }
    }

    if (Object.prototype.hasOwnProperty.call(props, "inputSchema")) {
      const inputSchema = asStaticObject(props.inputSchema!);
      if (inputSchema) {
        agent.inputSchema = inputSchema;
        const requiredInputs = deriveRequiredInputs(inputSchema);
        if (requiredInputs !== undefined) {
          agent.requiredInputs = requiredInputs;
        }
      } else {
        return {
          ok: false,
          diagnostics: [listDiagnostic({
            resourceType: "agent",
            path: file.relativePath,
            code: "AGENT_DEFINITION_INVALID",
            message: "Agent inputSchema must be a static object literal."
          })]
        };
      }
    }

    return { ok: true, resource: agent };

  } catch (error) {
    return {
      ok: false,
      diagnostics: [listDiagnostic({
        resourceType: "agent",
        path: file.relativePath,
        code: "AGENT_DEFINITION_INVALID",
        message: `Failed to read or parse agent file: ${error instanceof Error ? error.message : String(error)}`
      })]
    };
  }
}
