import { createHash } from "node:crypto";
import ts from "typescript";
import { ErrorCode } from "../errors/codes.js";
import { OpenFlowError } from "../errors/types.js";
import type { LoadedWorkflow, ParsedWorkflow, WorkflowMeta } from "./types.js";

function hashSource(sourceText: string): string {
  return createHash("sha256").update(sourceText).digest("hex");
}

function parseJsonLiteral(node: ts.Expression): unknown {
  if (ts.isStringLiteral(node)) return node.text;
  if (ts.isNumericLiteral(node)) return Number(node.text);
  if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
  if (node.kind === ts.SyntaxKind.NullKeyword) return null;
  if (ts.isArrayLiteralExpression(node)) {
    return node.elements.map(element => {
      if (ts.isSpreadElement(element)) {
        throw new OpenFlowError(ErrorCode.WORKFLOW_PARSE_ERROR, "Metadata inputSchema must be a static JSON object.");
      }
      return parseJsonLiteral(element);
    });
  }
  if (ts.isObjectLiteralExpression(node)) {
    const result: Record<string, unknown> = {};
    for (const prop of node.properties) {
      if (!ts.isPropertyAssignment(prop)) {
        throw new OpenFlowError(ErrorCode.WORKFLOW_PARSE_ERROR, "Metadata inputSchema must be a static JSON object.");
      }
      if (!ts.isIdentifier(prop.name) && !ts.isStringLiteral(prop.name)) {
        throw new OpenFlowError(ErrorCode.WORKFLOW_PARSE_ERROR, "Metadata inputSchema keys must be identifiers or string literals.");
      }
      result[prop.name.text] = parseJsonLiteral(prop.initializer);
    }
    return result;
  }
  throw new OpenFlowError(ErrorCode.WORKFLOW_PARSE_ERROR, "Metadata inputSchema must be a static JSON object.");
}

export function parseWorkflow(loaded: LoadedWorkflow): ParsedWorkflow {
  const sourceFile = ts.createSourceFile(
    loaded.sourcePath,
    loaded.sourceText,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS
  );

  if (sourceFile.statements.length === 0) {
    throw new OpenFlowError(
      ErrorCode.WORKFLOW_PARSE_ERROR,
      "Workflow file is empty."
    );
  }

  const statement = sourceFile.statements[0];

  const isVariable = statement && ts.isVariableStatement(statement);
  const modifiers = isVariable ? ts.getModifiers(statement as ts.VariableStatement) : undefined;
  const hasExport = isVariable && modifiers?.some(
    (m) => m.kind === ts.SyntaxKind.ExportKeyword
  );
  const declarations = isVariable ? (statement as ts.VariableStatement).declarationList.declarations : [];
  const firstDecl = declarations[0];
  const hasMetaName = declarations.length === 1 && 
    firstDecl &&
    ts.isIdentifier(firstDecl.name) && 
    firstDecl.name.text === "meta";

  if (!isVariable || !hasExport || !hasMetaName) {
    throw new OpenFlowError(
      ErrorCode.WORKFLOW_PARSE_ERROR,
      "Metadata ('export const meta') must be the first top-level statement."
    );
  }

  const initializer = firstDecl?.initializer;
  if (!initializer || !ts.isObjectLiteralExpression(initializer)) {
    throw new OpenFlowError(
      ErrorCode.WORKFLOW_PARSE_ERROR,
      "Metadata must be a literal object."
    );
  }

  const meta: any = {};
  for (const property of initializer.properties) {
    if (!ts.isPropertyAssignment(property)) {
      throw new OpenFlowError(
        ErrorCode.WORKFLOW_PARSE_ERROR,
        "Metadata properties must be standard property assignments."
      );
    }

    let keyName: string;
    if (ts.isIdentifier(property.name)) {
      keyName = property.name.text;
    } else if (ts.isStringLiteral(property.name)) {
      keyName = property.name.text;
    } else {
      throw new OpenFlowError(
        ErrorCode.WORKFLOW_PARSE_ERROR,
        "Metadata keys must be identifiers or string literals."
      );
    }

    const value = property.initializer;
    if (keyName === "phases") {
      if (!ts.isArrayLiteralExpression(value)) {
        throw new OpenFlowError(
          ErrorCode.WORKFLOW_PARSE_ERROR,
          "Metadata phases must be an array literal of string literals."
        );
      }
      const phases: string[] = [];
      for (const element of value.elements) {
        if (!ts.isStringLiteral(element)) {
          throw new OpenFlowError(
            ErrorCode.WORKFLOW_PARSE_ERROR,
            "Metadata phases must contain only string literals."
          );
        }
        phases.push(element.text);
      }
      meta[keyName] = phases;
    } else if (keyName === "tags") {
      if (!ts.isArrayLiteralExpression(value)) {
        throw new OpenFlowError(
          ErrorCode.WORKFLOW_PARSE_ERROR,
          "Metadata tags must be an array literal of string literals."
        );
      }
      const tags: string[] = [];
      for (const element of value.elements) {
        if (!ts.isStringLiteral(element)) {
          throw new OpenFlowError(
            ErrorCode.WORKFLOW_PARSE_ERROR,
            "Metadata tags must contain only string literals."
          );
        }
        tags.push(element.text);
      }
      meta[keyName] = tags;
    } else if (keyName === "name" || keyName === "description" || keyName === "version") {
      if (!ts.isStringLiteral(value)) {
        throw new OpenFlowError(
          ErrorCode.WORKFLOW_PARSE_ERROR,
          `Metadata ${keyName} must be a string literal.`
        );
      }
      meta[keyName] = value.text;
    } else if (keyName === "inputSchema") {
      meta[keyName] = parseJsonLiteral(value);
    } else {
      throw new OpenFlowError(
        ErrorCode.WORKFLOW_PARSE_ERROR,
        `Unexpected metadata property: ${keyName}`
      );
    }
  }

  if (!meta.name || meta.name.trim() === "") {
    throw new OpenFlowError(
      ErrorCode.WORKFLOW_PARSE_ERROR,
      "Metadata name is required and cannot be empty."
    );
  }
  if (!meta.description || meta.description.trim() === "") {
    throw new OpenFlowError(
      ErrorCode.WORKFLOW_PARSE_ERROR,
      "Metadata description is required and cannot be empty."
    );
  }

  const body = loaded.sourceText.substring(statement.end).trim();
  const sourceHash = hashSource(loaded.sourceText);

  return {
    meta: meta as WorkflowMeta,
    body,
    sourcePath: loaded.sourcePath,
    sourceText: loaded.sourceText,
    sourceHash
  };
}
