import { promises as fs } from "node:fs";
import ts from "typescript";
import { 
  CandidateFile, 
  ResourceExtractionResult, 
  ListedWorkflow, 
  ListDiagnostic 
} from "./types.js";
import { 
  listDiagnostic, 
  WORKFLOW_METADATA_MISSING, 
  WORKFLOW_METADATA_INVALID 
} from "./diagnostics.js";
import { 
  parseSourceFile, 
  extractStaticValue 
} from "./static-values.js";

export async function extractWorkflow(file: CandidateFile): Promise<ResourceExtractionResult> {
  let sourceText: string;
  try {
    sourceText = await fs.readFile(file.absolutePath, "utf8");
  } catch (err: any) {
    return {
      ok: false,
      diagnostics: [listDiagnostic({
        resourceType: "workflow",
        code: WORKFLOW_METADATA_MISSING,
        message: `Could not read file: ${err.message}`,
        path: file.relativePath,
      })]
    };
  }

  const sourceFile = parseSourceFile(file.absolutePath, sourceText);
  const firstStatement = sourceFile.statements[0];

  if (!firstStatement) {
    return {
      ok: false,
      diagnostics: [listDiagnostic({
        resourceType: "workflow",
        code: WORKFLOW_METADATA_MISSING,
        message: "Workflow file is empty",
        path: file.relativePath,
      })]
    };
  }

  // Expect: export const meta = { ... }
  if (!ts.isVariableStatement(firstStatement)) {
    return {
      ok: false,
      diagnostics: [listDiagnostic({
        resourceType: "workflow",
        code: WORKFLOW_METADATA_MISSING,
        message: "First statement must be 'export const meta'",
        path: file.relativePath,
      })]
    };
  }

  const hasExport = firstStatement.modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword);
  if (!hasExport) {
    return {
      ok: false,
      diagnostics: [listDiagnostic({
        resourceType: "workflow",
        code: WORKFLOW_METADATA_MISSING,
        message: "First statement must be exported",
        path: file.relativePath,
      })]
    };
  }

  const declaration = firstStatement.declarationList.declarations[0];
  if (!declaration || !ts.isIdentifier(declaration.name) || declaration.name.text !== "meta") {
     return {
      ok: false,
      diagnostics: [listDiagnostic({
        resourceType: "workflow",
        code: WORKFLOW_METADATA_MISSING,
        message: "First exported variable must be 'meta'",
        path: file.relativePath,
      })]
    };
  }

  if (!declaration.initializer) {
     return {
      ok: false,
      diagnostics: [listDiagnostic({
        resourceType: "workflow",
        code: WORKFLOW_METADATA_MISSING,
        message: "'meta' must have an initializer",
        path: file.relativePath,
      })]
    };
  }

  const staticValueResult = extractStaticValue(declaration.initializer);
  if (!staticValueResult.ok) {
    return {
      ok: false,
      diagnostics: [listDiagnostic({
        resourceType: "workflow",
        code: WORKFLOW_METADATA_INVALID,
        message: `Metadata must be static: ${staticValueResult.message}`,
        path: file.relativePath,
      })]
    };
  }

  const meta = staticValueResult.value;
  if (typeof meta !== "object" || meta === null || Array.isArray(meta)) {
     return {
      ok: false,
      diagnostics: [listDiagnostic({
        resourceType: "workflow",
        code: WORKFLOW_METADATA_INVALID,
        message: "Metadata must be an object",
        path: file.relativePath,
      })]
    };
  }

  const diagnostics: ListDiagnostic[] = [];
  const { name, description, phases, version, tags, inputSchema, ...rest } = meta as any;

  if (typeof name !== "string" || name.trim() === "") {
    diagnostics.push(listDiagnostic({
      resourceType: "workflow",
      code: WORKFLOW_METADATA_INVALID,
      message: "Workflow name must be a non-empty string",
      path: file.relativePath,
    }));
  }

  if (typeof description !== "string" || description.trim() === "") {
    diagnostics.push(listDiagnostic({
      resourceType: "workflow",
      code: WORKFLOW_METADATA_INVALID,
      message: "Workflow description must be a non-empty string",
      path: file.relativePath,
    }));
  }

  if (phases !== undefined && (!Array.isArray(phases) || phases.some(p => typeof p !== "string"))) {
    diagnostics.push(listDiagnostic({
      resourceType: "workflow",
      code: WORKFLOW_METADATA_INVALID,
      message: "Workflow phases must be an array of strings",
      path: file.relativePath,
    }));
  }

  if (version !== undefined && typeof version !== "string") {
    diagnostics.push(listDiagnostic({
      resourceType: "workflow",
      code: WORKFLOW_METADATA_INVALID,
      message: "Workflow version must be a string",
      path: file.relativePath,
    }));
  }

  if (tags !== undefined && (!Array.isArray(tags) || tags.some(t => typeof t !== "string"))) {
    diagnostics.push(listDiagnostic({
      resourceType: "workflow",
      code: WORKFLOW_METADATA_INVALID,
      message: "Workflow tags must be an array of strings",
      path: file.relativePath,
    }));
  }

  const unknownFields = Object.keys(rest);
  if (unknownFields.length > 0) {
     diagnostics.push(listDiagnostic({
      resourceType: "workflow",
      code: WORKFLOW_METADATA_INVALID,
      message: `Unknown metadata fields: ${unknownFields.join(", ")}`,
      path: file.relativePath,
    }));
  }

  if (diagnostics.length > 0) {
    return { ok: false, diagnostics };
  }

  const resource: ListedWorkflow = {
    type: "workflow",
    name,
    description,
    path: file.relativePath,
    valid: true,
  };

  if (phases) resource.phases = phases;
  if (version) resource.version = version;
  if (tags) resource.tags = tags;
  if (inputSchema !== undefined) resource.inputSchema = inputSchema;

  const result: ResourceExtractionResult = { ok: true, resource };
  if (diagnostics.length > 0) {
    result.diagnostics = diagnostics;
  }
  return result;
}
