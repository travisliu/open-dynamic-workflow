import { createHash } from "node:crypto";
import ts from "typescript";
import { ErrorCode } from "../errors/codes.js";
import { ExecflowError } from "../errors/types.js";
import type { LoadedWorkflow, ParsedWorkflow, WorkflowMeta } from "./types.js";

function hashSource(sourceText: string): string {
  return createHash("sha256").update(sourceText).digest("hex");
}

export function parseWorkflow(loaded: LoadedWorkflow): ParsedWorkflow {
  const sourceFile = ts.createSourceFile(
    loaded.sourcePath,
    loaded.sourceText,
    ts.ScriptTarget.Latest,
    true
  );

  if (sourceFile.statements.length === 0) {
    throw new ExecflowError(
      ErrorCode.WORKFLOW_PARSE_ERROR,
      "Workflow file is empty."
    );
  }

  const statement = sourceFile.statements[0];

  if (!statement || !ts.isVariableStatement(statement)) {
    throw new ExecflowError(
      ErrorCode.WORKFLOW_PARSE_ERROR,
      "Metadata must be the first top-level statement."
    );
  }

  const hasExport = statement.modifiers?.some(
    (m) => m.kind === ts.SyntaxKind.ExportKeyword
  );
  if (!hasExport) {
    throw new ExecflowError(
      ErrorCode.WORKFLOW_PARSE_ERROR,
      "Metadata must be exported ('export const meta')."
    );
  }

  const declarations = statement.declarationList.declarations;
  if (declarations.length !== 1) {
    throw new ExecflowError(
      ErrorCode.WORKFLOW_PARSE_ERROR,
      "Metadata variable statement must declare exactly one variable."
    );
  }

  const declaration = declarations[0];
  if (!declaration || !ts.isIdentifier(declaration.name) || declaration.name.text !== "meta") {
    throw new ExecflowError(
      ErrorCode.WORKFLOW_PARSE_ERROR,
      "Metadata variable must be named 'meta'."
    );
  }

  const initializer = declaration.initializer;
  if (!initializer || !ts.isObjectLiteralExpression(initializer)) {
    throw new ExecflowError(
      ErrorCode.WORKFLOW_PARSE_ERROR,
      "Metadata must be a literal object."
    );
  }

  const meta: any = {};
  for (const property of initializer.properties) {
    if (!ts.isPropertyAssignment(property)) {
      throw new ExecflowError(
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
      throw new ExecflowError(
        ErrorCode.WORKFLOW_PARSE_ERROR,
        "Metadata keys must be identifiers or string literals."
      );
    }

    const value = property.initializer;
    if (keyName === "phases") {
      if (!ts.isArrayLiteralExpression(value)) {
        throw new ExecflowError(
          ErrorCode.WORKFLOW_PARSE_ERROR,
          "Metadata phases must be an array literal of string literals."
        );
      }
      const phases: string[] = [];
      for (const element of value.elements) {
        if (!ts.isStringLiteral(element)) {
          throw new ExecflowError(
            ErrorCode.WORKFLOW_PARSE_ERROR,
            "Metadata phases must contain only string literals."
          );
        }
        phases.push(element.text);
      }
      meta[keyName] = phases;
    } else if (keyName === "tags") {
      if (!ts.isArrayLiteralExpression(value)) {
        throw new ExecflowError(
          ErrorCode.WORKFLOW_PARSE_ERROR,
          "Metadata tags must be an array literal of string literals."
        );
      }
      const tags: string[] = [];
      for (const element of value.elements) {
        if (!ts.isStringLiteral(element)) {
          throw new ExecflowError(
            ErrorCode.WORKFLOW_PARSE_ERROR,
            "Metadata tags must contain only string literals."
          );
        }
        tags.push(element.text);
      }
      meta[keyName] = tags;
    } else if (keyName === "name" || keyName === "description" || keyName === "version") {
      if (!ts.isStringLiteral(value)) {
        throw new ExecflowError(
          ErrorCode.WORKFLOW_PARSE_ERROR,
          `Metadata ${keyName} must be a string literal.`
        );
      }
      meta[keyName] = value.text;
    } else {
      throw new ExecflowError(
        ErrorCode.WORKFLOW_PARSE_ERROR,
        `Unexpected metadata property: ${keyName}`
      );
    }
  }

  if (!meta.name || meta.name.trim() === "") {
    throw new ExecflowError(
      ErrorCode.WORKFLOW_PARSE_ERROR,
      "Metadata name is required and cannot be empty."
    );
  }
  if (!meta.description || meta.description.trim() === "") {
    throw new ExecflowError(
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
