import ts from "typescript";
import { ErrorCode } from "../errors/codes.js";
import { OpenFlowError } from "../errors/types.js";
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
          report(node, "require() is not supported. Direct module access is not allowed.");
        } else if (calleeText === "shell") {
          report(node, "shell() is not supported in the MVP.");
        } else if (calleeText === "pipeline") {
          if (node.arguments.length < 2) {
            report(node, "pipeline() requires at least 2 arguments: items and stages.");
          } else if (node.arguments.length > 3) {
            report(node, "pipeline() accepts at most 3 arguments: items, stages, and options.");
          }

          const stagesArg = node.arguments[1];
          if (stagesArg) {
            if (ts.isArrayLiteralExpression(stagesArg)) {
              const stageNamesSeen = new Set<string>();
              for (const element of stagesArg.elements) {
                if (!ts.isObjectLiteralExpression(element)) {
                  report(element, "pipeline() stages must be named stage objects, not function shorthands. Recommend using { name: 'stageName', run: ... }");
                } else {
                  let hasNameProp = false;
                  let nameValue: string | undefined;

                  for (const prop of element.properties) {
                    if (ts.isPropertyAssignment(prop) || ts.isShorthandPropertyAssignment(prop) || ts.isSpreadAssignment(prop) || ts.isMethodDeclaration(prop)) {
                      const propName = ts.isPropertyAssignment(prop) || ts.isMethodDeclaration(prop)
                        ? (ts.isIdentifier(prop.name) || ts.isStringLiteral(prop.name) ? prop.name.text : prop.name.getText())
                        : ts.isShorthandPropertyAssignment(prop) ? prop.name.text : "";
                      
                      if (propName === "name") {
                        hasNameProp = true;
                        if (ts.isPropertyAssignment(prop) && ts.isStringLiteral(prop.initializer)) {
                          nameValue = prop.initializer.text;
                        }
                      }
                    }
                  }

                  if (!hasNameProp) {
                    report(element, "pipeline() stage object is missing 'name' property.");
                  } else if (nameValue !== undefined) {
                    if (stageNamesSeen.has(nameValue)) {
                      report(element, `pipeline() duplicate stage name detected: '${nameValue}'.`);
                    } else {
                      stageNamesSeen.add(nameValue);
                    }
                  }
                }
              }
            } else if (ts.isArrowFunction(stagesArg) || ts.isFunctionExpression(stagesArg)) {
              report(stagesArg, "pipeline() stages must be named stage objects, not function shorthands. Recommend using { name: 'stageName', run: ... }");
            }
          }

          const optionsArg = node.arguments[2];
          if (optionsArg && ts.isObjectLiteralExpression(optionsArg)) {
            const allowedOptionKeys = ["label", "strategy", "concurrency", "stageConcurrency", "preserveOrder", "failFast"];
            for (const prop of optionsArg.properties) {
              if (ts.isPropertyAssignment(prop) || ts.isShorthandPropertyAssignment(prop) || ts.isSpreadAssignment(prop) || ts.isMethodDeclaration(prop)) {
                const propName = ts.isPropertyAssignment(prop) || ts.isMethodDeclaration(prop)
                  ? (ts.isIdentifier(prop.name) || ts.isStringLiteral(prop.name) ? prop.name.text : prop.name.getText())
                  : ts.isShorthandPropertyAssignment(prop) ? prop.name.text : "";
                
                if (propName && !allowedOptionKeys.includes(propName)) {
                  report(prop, `pipeline() options contain unsupported key '${propName}'.`);
                }

                if (propName === "strategy" && ts.isPropertyAssignment(prop) && ts.isStringLiteral(prop.initializer)) {
                  const strategyVal = prop.initializer.text;
                  if (strategyVal !== "item-streaming" && strategyVal !== "stage-barrier") {
                    report(prop.initializer, `pipeline() options strategy must be 'item-streaming' or 'stage-barrier'.`);
                  }
                }
              }
            }
          }
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

    if (ts.isNewExpression(node)) {
      if (ts.isIdentifier(node.expression) && node.expression.text === "Date" && (!node.arguments || node.arguments.length === 0)) {
        report(node, "new Date() without arguments is not allowed.");
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
    throw new OpenFlowError(
      ErrorCode.WORKFLOW_VALIDATION_ERROR,
      `Workflow validation failed:\n${summary}`
    );
  }
}
