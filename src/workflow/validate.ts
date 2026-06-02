import ts from "typescript";
import { ErrorCode } from "../errors/codes.js";
import { ExecflowError } from "../errors/types.js";
import type { ParsedWorkflow, WorkflowValidationIssue } from "./types.js";

export interface ValidateWorkflowOptions {
  allowImports: false;
  allowShell: false;
}

export function validateWorkflow(
  workflow: ParsedWorkflow,
  options: ValidateWorkflowOptions
): WorkflowValidationIssue[] {
  const issues: WorkflowValidationIssue[] = [];
  const sourceFile = ts.createSourceFile(
    workflow.sourcePath,
    workflow.sourceText,
    ts.ScriptTarget.Latest,
    true
  );

  function report(node: ts.Node, message: string) {
    const { line, character } = sourceFile.getLineAndCharacterOfPosition(node.getStart());
    issues.push({
      code: "WORKFLOW_VALIDATION_ERROR",
      message,
      line: line + 1,
      column: character + 1
    });
  }

  function visit(node: ts.Node) {
    // Skip the metadata declaration statement
    if (sourceFile.statements.length > 0 && node === sourceFile.statements[0]) {
      return;
    }

    if (ts.isImportDeclaration(node) || ts.isImportEqualsDeclaration(node)) {
      report(node, "Arbitrary imports are not allowed.");
    }

    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      if (ts.isIdentifier(callee)) {
        const calleeText = callee.text;
        if (calleeText === "require") {
          report(node, "Direct module access is not allowed.");
        } else if (calleeText === "shell") {
          report(node, "shell() is not supported in the MVP.");
        } else if (calleeText === "pipeline") {
          report(node, "pipeline() is not supported in the MVP.");
        } else if (["read", "write"].includes(calleeText)) {
          report(node, `${calleeText}() is not supported in the MVP.`);
        } else if (calleeText === "fetch") {
          report(node, "Network APIs are not part of MVP workflow capabilities.");
        } else if (calleeText === "Function") {
          report(node, "Dynamic function creation is not allowed.");
        }
      }
      if (callee.kind === ts.SyntaxKind.ImportKeyword) {
        report(node, "Arbitrary imports are not allowed.");
      }
    }

    if (ts.isPropertyAccessExpression(node)) {
      const expr = node.expression;
      const name = node.name;
      
      if (name.text === "constructor") {
        report(node, "Access to 'constructor' is not allowed.");
      } else if (name.text === "__proto__") {
        report(node, "Access to '__proto__' is not allowed.");
      } else if (ts.isIdentifier(expr)) {
        if (expr.text === "Date" && name.text === "now") {
          report(node, "Date.now() is not allowed.");
        } else if (expr.text === "Math" && name.text === "random") {
          report(node, "Math.random() is not allowed.");
        }
      }
    }

    if (ts.isElementAccessExpression(node)) {
      const arg = node.argumentExpression;
      if (ts.isStringLiteral(arg)) {
        if (arg.text === "constructor") {
          report(node, "Access to 'constructor' is not allowed.");
        } else if (arg.text === "__proto__") {
          report(node, "Access to '__proto__' is not allowed.");
        }
      }
    }

    if (ts.isIdentifier(node)) {
      const text = node.text;
      const isPropertyName = ts.isPropertyAccessExpression(node.parent) && node.parent.name === node;
      const isPropertyAssignmentName = ts.isPropertyAssignment(node.parent) && node.parent.name === node;
      
      if (!isPropertyName && !isPropertyAssignmentName) {
        if (text === "process") {
          report(node, "Direct process access is not allowed.");
        } else if (text === "fs") {
          report(node, "Direct module access is not allowed.");
        } else if (text === "child_process") {
          report(node, "Shell/process spawning is not allowed.");
        } else if (text === "globalThis" || text === "global" || text === "window" || text === "self") {
          report(node, "Global object access is not allowed.");
        } else if (text === "Function") {
          report(node, "Dynamic function creation is not allowed.");
        }
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return issues;
}

export function assertWorkflowValid(
  workflow: ParsedWorkflow,
  options: ValidateWorkflowOptions
): void {
  const issues = validateWorkflow(workflow, options);
  if (issues.length > 0) {
    const summary = issues.map((issue) => `${issue.message}`).join("\n");
    throw new ExecflowError(
      ErrorCode.WORKFLOW_VALIDATION_ERROR,
      `Workflow validation failed:\n${summary}`
    );
  }
}
