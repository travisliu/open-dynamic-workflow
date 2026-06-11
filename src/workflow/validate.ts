import ts from "typescript";
import AjvModule from "ajv";
import type { SharedAgentRegistry } from "../shared-agents/registry.js";
import { ErrorCode } from "../errors/codes.js";
import { OpenFlowError } from "../errors/types.js";
import type { ParsedWorkflow, WorkflowValidationIssue } from "./types.js";

const Ajv = (AjvModule as any).default || AjvModule;
const ajv = new Ajv({ allErrors: true });

function isStaticValue(node: ts.Node): boolean {
  if (ts.isStringLiteral(node) || ts.isNumericLiteral(node) || node.kind === ts.SyntaxKind.TrueKeyword || node.kind === ts.SyntaxKind.FalseKeyword || node.kind === ts.SyntaxKind.NullKeyword) {
    return true;
  }
  if (ts.isArrayLiteralExpression(node)) {
    return node.elements.every(isStaticValue);
  }
  if (ts.isObjectLiteralExpression(node)) {
    return node.properties.every(prop => ts.isPropertyAssignment(prop) && isStaticValue(prop.initializer));
  }
  return false;
}

function parseStaticProperties(node: ts.Node | undefined): any {
  if (!node) return undefined;
  if (ts.isStringLiteral(node)) {
    return node.text;
  }
  if (ts.isNumericLiteral(node)) {
    return Number(node.text);
  }
  if (node.kind === ts.SyntaxKind.TrueKeyword) {
    return true;
  }
  if (node.kind === ts.SyntaxKind.FalseKeyword) {
    return false;
  }
  if (node.kind === ts.SyntaxKind.NullKeyword) {
    return null;
  }
  if (ts.isArrayLiteralExpression(node)) {
    return node.elements.map(parseStaticProperties);
  }
  if (ts.isObjectLiteralExpression(node)) {
    const obj: any = {};
    for (const prop of node.properties) {
      if (ts.isPropertyAssignment(prop)) {
        if (ts.isIdentifier(prop.name) || ts.isStringLiteral(prop.name)) {
          const key = prop.name.text;
          const val = parseStaticProperties(prop.initializer);
          if (val !== undefined) {
            obj[key] = val;
          }
        }
      }
    }
    return obj;
  }
  return undefined;
}

export interface ValidateWorkflowOptions {
  allowImports: false;
  allowShell: false;
  allowDynamicSharedAgentIds?: boolean;
  knownSharedAgentIds?: ReadonlySet<string>;
  sharedAgentRegistry?: SharedAgentRegistry;
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

  const knownSharedAgentIds = options.knownSharedAgentIds ?? (
    options.sharedAgentRegistry
      ? new Set(options.sharedAgentRegistry.list().map(entry => entry.id))
      : undefined
  );
  function validateSharedAgentId(idArg: ts.Node | undefined) {
    if (!idArg) {
      report(sourceFile, "Shared agent requires at least a shared agent ID.");
      return;
    }
    if (ts.isStringLiteral(idArg)) {
      const id = idArg.text;
      if (id.startsWith(".") || id.startsWith("/") || id.includes("/") || id.includes("\\")) {
        report(idArg, "Shared agent definition references must use a registry ID, not a path.");
      } else if (knownSharedAgentIds && !knownSharedAgentIds.has(id)) {
        report(idArg, `Shared agent '${id}' was not found in the configured registry.`);
      }
    } else if (options.allowDynamicSharedAgentIds === false) {
      report(idArg, "Shared agent ID must be a string literal.");
    }
  }

  function validateSharedAgentInput(idArg: ts.Node | undefined, inputArg: ts.Node | undefined, isDefinitionForm: boolean = false) {
    if (!options.sharedAgentRegistry || !idArg || !ts.isStringLiteral(idArg)) {
      return;
    }
    const id = idArg.text;
    const entry = options.sharedAgentRegistry.get(id);
    if (!entry || !entry.definition.inputSchema) {
      return;
    }
    
    const schema = entry.definition.inputSchema;
    let parsedInput = parseStaticProperties(inputArg);
    
    if (parsedInput === undefined) {
      if (!inputArg) {
        try {
          const validate = ajv.compile(schema);
          const valid = validate({});
          if (!valid && validate.errors) {
            const hasRequired = validate.errors.some((e: any) => e.keyword === "required");
            if (hasRequired) {
              report(sourceFile, `Shared agent '${id}' requires input matching schema.`);
            }
          }
        } catch (err) {}
      }
      return;
    }
    
    try {
      const validate = ajv.compile(schema);
      const valid = validate(parsedInput);
      if (!valid && validate.errors) {
        let hasDynamicProps = false;
        if (inputArg && ts.isObjectLiteralExpression(inputArg)) {
          for (const prop of inputArg.properties) {
            if (ts.isPropertyAssignment(prop)) {
              if (!isStaticValue(prop.initializer)) {
                hasDynamicProps = true;
                break;
              }
            } else {
              hasDynamicProps = true;
              break;
            }
          }
        }

        for (const error of validate.errors) {
          if (error.keyword === "required" && hasDynamicProps) {
            continue;
          }
          const path = error.instancePath ? ` at ${error.instancePath}` : "";
          report(inputArg || sourceFile, `Shared agent '${id}' input validation failed: ${error.message}${path}`);
        }
      }
    } catch (err: any) {}
  }

  function validateAgentCall(node: ts.CallExpression, isContextForm: boolean) {
    const firstArg = node.arguments[0];
    const callPrefix = isContextForm ? "ctx.agent()" : "agent()";

    if (!firstArg) {
      report(node, `${callPrefix} requires an object literal argument.`);
      return;
    }

    if (!ts.isObjectLiteralExpression(firstArg)) {
      report(firstArg, `${callPrefix} argument must be an object literal.`);
      return;
    }

    let definitionProp: ts.PropertyAssignment | ts.ShorthandPropertyAssignment | undefined;
    let promptProp: ts.PropertyAssignment | ts.ShorthandPropertyAssignment | undefined;
    let hasSpread = false;

    for (const prop of firstArg.properties) {
      if (ts.isSpreadAssignment(prop)) {
        hasSpread = true;
      } else if (ts.isPropertyAssignment(prop) || ts.isShorthandPropertyAssignment(prop)) {
        const propName = ts.isPropertyAssignment(prop) || ts.isShorthandPropertyAssignment(prop)
          ? (ts.isIdentifier(prop.name) || ts.isStringLiteral(prop.name) ? prop.name.text : prop.name.getText())
          : "";
        if (propName === "definition") {
          definitionProp = prop;
        } else if (propName === "prompt") {
          promptProp = prop;
        }

        if (propName === "permissions" && ts.isPropertyAssignment(prop)) {
          const init = prop.initializer;
          if (ts.isObjectLiteralExpression(init)) {
            let hasMode = false;
            let modeValue: string | undefined;
            let hasDynamicProp = false;
            const allowedKeys = ["mode"];
            for (const innerProp of init.properties) {
              if (ts.isPropertyAssignment(innerProp)) {
                const innerName = ts.isIdentifier(innerProp.name) || ts.isStringLiteral(innerProp.name) ? innerProp.name.text : innerProp.name.getText();
                if (!allowedKeys.includes(innerName)) {
                  report(innerProp, `${callPrefix} permissions contain unsupported key '${innerName}'.`);
                }
                if (innerName === "mode") {
                  hasMode = true;
                  const val = innerProp.initializer;
                  if (ts.isStringLiteral(val)) {
                    modeValue = val.text;
                  } else if (
                    ts.isNumericLiteral(val) ||
                    ts.isBigIntLiteral(val) ||
                    ts.isObjectLiteralExpression(val) ||
                    ts.isArrayLiteralExpression(val) ||
                    val.kind === ts.SyntaxKind.TrueKeyword ||
                    val.kind === ts.SyntaxKind.FalseKeyword ||
                    val.kind === ts.SyntaxKind.NullKeyword
                  ) {
                    report(val, `${callPrefix} permissions.mode must be a string literal.`);
                  }
                }
              } else if (ts.isShorthandPropertyAssignment(innerProp)) {
                const innerName = innerProp.name.text;
                if (!allowedKeys.includes(innerName)) {
                  report(innerProp, `${callPrefix} permissions contain unsupported key '${innerName}'.`);
                }
                if (innerName === "mode") {
                  hasMode = true;
                }
              } else {
                hasDynamicProp = true;
              }
            }
            if (!hasMode && !hasDynamicProp) {
              report(init, `${callPrefix} permissions must include a 'mode' property.`);
            } else if (hasMode && modeValue !== undefined && modeValue !== "dangerously-full-access") {
              report(init, `${callPrefix} permissions.mode must be 'dangerously-full-access'.`);
            }
          } else if (
            ts.isStringLiteral(init) ||
            ts.isNumericLiteral(init) ||
            ts.isBigIntLiteral(init) ||
            ts.isArrayLiteralExpression(init) ||
            init.kind === ts.SyntaxKind.TrueKeyword ||
            init.kind === ts.SyntaxKind.FalseKeyword ||
            init.kind === ts.SyntaxKind.NullKeyword
          ) {
            report(init, `${callPrefix} permissions must be an object literal.`);
          }
        }
      }
    }

    if (definitionProp) {
      const definitionArg = ts.isPropertyAssignment(definitionProp) ? definitionProp.initializer : undefined;
      validateSharedAgentId(definitionArg);
      validateSharedAgentInput(definitionArg, firstArg, true);
    } else {
      if (!promptProp && !hasSpread) {
        report(firstArg, `${callPrefix} is missing required 'prompt' property.`);
      } else if (promptProp && ts.isPropertyAssignment(promptProp)) {
        const init = promptProp.initializer;
        if (ts.isStringLiteral(init)) {
          if (init.text.trim() === "") {
            report(init, `${callPrefix} prompt cannot be empty.`);
          }
        } else if (
          ts.isNumericLiteral(init) ||
          ts.isBigIntLiteral(init) ||
          ts.isObjectLiteralExpression(init) ||
          ts.isArrayLiteralExpression(init) ||
          init.kind === ts.SyntaxKind.TrueKeyword ||
          init.kind === ts.SyntaxKind.FalseKeyword ||
          init.kind === ts.SyntaxKind.NullKeyword
        ) {
          report(init, `${callPrefix} prompt must be a string literal.`);
        }
      }
    }
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
        } else if (calleeText === "agent") {
          validateAgentCall(node, false);
        } else if (["read", "write"].includes(calleeText)) {
          report(node, `${calleeText}() is not supported in the MVP.`);
        } else if (calleeText === "fetch") {
          report(node, "Network APIs are not part of MVP workflow capabilities.");
        } else if (calleeText === "Function") {
          report(node, "Dynamic function creation is not allowed.");
        }
      } else if (ts.isPropertyAccessExpression(callee)) {
        const obj = callee.expression;
        const prop = callee.name;
        if (ts.isIdentifier(obj) && obj.text === "ctx" && prop.text === "agent") {
          validateAgentCall(node, true);
        }
      }
      if (callee.kind === ts.SyntaxKind.ImportKeyword) {
        report(node, "Arbitrary imports are not allowed.");
      }
    }

    if (ts.isNewExpression(node)) {
      const expression = node.expression;
      if (ts.isIdentifier(expression) && expression.text === "Date" && (!node.arguments || node.arguments.length === 0)) {
        report(node, "new Date() without arguments is not allowed because it would break resume/cache determinism.");
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
