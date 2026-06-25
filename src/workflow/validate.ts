import ts from "typescript";
import AjvModule from "ajv";
import { resolve } from "node:path";
import type { SharedAgentRegistry } from "../shared-agents/registry.js";
import { ErrorCode } from "../errors/codes.js";
import { OpenDynamicWorkflowError } from "../errors/types.js";
import { isThinkingEffort, THINKING_EFFORT_VALUES } from "../types/index.js";

import type { ParsedWorkflow, WorkflowValidationIssue } from "./types.js";
import type { WorkflowRegistry } from "./registry.js";
import { isPathLikeWorkflowName } from "./workflow-call.js";
import type { ToolRegistry } from "../types/tool.js";

const Ajv = (AjvModule as any).default || AjvModule;
const ajv = new Ajv({ allErrors: true });

function isStaticValue(node: ts.Node): boolean {
  if (ts.isStringLiteral(node) || ts.isNumericLiteral(node) || node.kind === ts.SyntaxKind.TrueKeyword || node.kind === ts.SyntaxKind.FalseKeyword || node.kind === ts.SyntaxKind.NullKeyword) {
    return true;
  }
  if (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.MinusToken && ts.isNumericLiteral(node.operand)) {
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

function hasStaticallyUnsafeJson(node: ts.Node): string | null {
  if (ts.isFunctionExpression(node) || ts.isArrowFunction(node) || ts.isMethodDeclaration(node) || ts.isClassExpression(node)) {
    return "functions/classes are not JSON-safe";
  }
  if (ts.isIdentifier(node)) {
    if (node.text === "undefined") {
      return "undefined is not JSON-safe";
    }
    if (node.text === "Symbol") {
      return "Symbol is not JSON-safe";
    }
  }
  if (ts.isArrayLiteralExpression(node)) {
    for (const elem of node.elements) {
      const unsafe = hasStaticallyUnsafeJson(elem);
      if (unsafe) return unsafe;
    }
  }
  if (ts.isObjectLiteralExpression(node)) {
    for (const prop of node.properties) {
      if (ts.isPropertyAssignment(prop)) {
        const unsafe = hasStaticallyUnsafeJson(prop.initializer);
        if (unsafe) return unsafe;
      }
    }
  }
  return null;
}

function parseStaticProperties(node: ts.Node | undefined): any {
  if (!node) return undefined;
  if (ts.isStringLiteral(node)) {
    return node.text;
  }
  if (ts.isNumericLiteral(node)) {
    return Number(node.text);
  }
  if (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.MinusToken && ts.isNumericLiteral(node.operand)) {
    return -Number(node.operand.text);
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
  allowDynamicSharedAgentIds?: boolean | undefined;
  knownSharedAgentIds?: ReadonlySet<string> | undefined;
  sharedAgentRegistry?: SharedAgentRegistry | undefined;
  knownWorkflowNames?: ReadonlySet<string> | undefined;
  workflowInputSchemas?: ReadonlyMap<string, unknown> | undefined;
  knownToolIds?: ReadonlySet<string> | undefined;
  toolRegistry?: ToolRegistry | undefined;
  maxLoopRounds?: number | undefined;
}

function getObjectLiteralProperty(node: ts.ObjectLiteralExpression, name: string): ts.Expression | undefined {
  for (const prop of node.properties) {
    if (!ts.isPropertyAssignment(prop)) continue;
    const propName = ts.isIdentifier(prop.name) || ts.isStringLiteral(prop.name) ? prop.name.text : undefined;
    if (propName === name) return prop.initializer;
  }
  return undefined;
}

export function validateWorkflow(
  workflow: ParsedWorkflow,
  options: ValidateWorkflowOptions
): WorkflowValidationIssue[] {
  const issues: WorkflowValidationIssue[] = [];
  const loopLabelsSeen = new Set<string>();
  const loopRunFunctions = new Set<ts.Node>();
  const sourceFile = ts.createSourceFile(
    workflow.sourcePath,
    workflow.sourceText,
    ts.ScriptTarget.Latest,
    true
  );

  // Find the exported default workflow function to get its context parameter name
  const contextParameterNames = new Set<string>(["ctx", "context"]);
  for (const statement of sourceFile.statements) {
    let workflowFn: ts.FunctionLikeDeclaration | undefined;

    if (ts.isExportAssignment(statement)) {
      const expr = statement.expression;
      if (ts.isFunctionExpression(expr) || ts.isArrowFunction(expr)) {
        workflowFn = expr;
      }
    } else if (ts.isFunctionDeclaration(statement)) {
      const isDefaultExport = statement.modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword) &&
                              statement.modifiers?.some(m => m.kind === ts.SyntaxKind.DefaultKeyword);
      if (isDefaultExport) {
        workflowFn = statement;
      }
    }

    if (workflowFn && workflowFn.parameters.length > 0) {
      const firstParam = workflowFn.parameters[0];
      if (firstParam && ts.isIdentifier(firstParam.name)) {
        contextParameterNames.add(firstParam.name.text);
      }
    }
  }

  function report(node: ts.Node, message: string, severity?: "error" | "warning") {
    const { line, character } = sourceFile.getLineAndCharacterOfPosition(node.getStart());
    issues.push({
      code: "WORKFLOW_VALIDATION_ERROR",
      message,
      line: line + 1,
      column: character + 1,
      severity
    });
  }

  // Validate metadata inputSchema
  if (workflow.meta.inputSchema) {
    try {
      ajv.compile(workflow.meta.inputSchema);
    } catch (err: any) {
      report(sourceFile, `Metadata 'inputSchema' is not a valid JSON Schema: ${err.message}`);
    }
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

  function validateSharedAgentInput(idArg: ts.Node | undefined, inputArg: ts.Node | undefined) {
    if (!options.sharedAgentRegistry || !idArg || !ts.isStringLiteral(idArg)) {
      return;
    }
    const id = idArg.text;
    const entry = options.sharedAgentRegistry.get(id);
    if (!entry || !entry.definition.inputSchema) {
      return;
    }
    
    const schema = entry.definition.inputSchema;
    const parsedInput = parseStaticProperties(inputArg);
    
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
        } catch {
          // ignore validation errors
        }
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
    } catch {
      // ignore validation errors
    }
  }

  function validateInputAgainstSchema(name: string, schema: any, argsExpr: ts.Expression | undefined) {
    if (argsExpr === undefined) {
      return;
    }
    const parsedArgs = parseStaticProperties(argsExpr);
    if (parsedArgs === undefined) {
      return;
    }
    try {
      const validate = ajv.compile(schema);
      const valid = validate(parsedArgs);
      if (!valid && validate.errors) {
        let hasDynamicProps = false;
        if (argsExpr && ts.isObjectLiteralExpression(argsExpr)) {
          for (const prop of argsExpr.properties) {
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
          report(argsExpr || sourceFile, `Workflow '${name}' input validation failed: ${error.message}${path}`);
        }
      }
    } catch {
      // ignore validation errors
    }
  }

  function validateWorkflowCall(node: ts.CallExpression, isContextForm: boolean, contextName: string = "workflow") {
    const firstArg = node.arguments[0];
    const callPrefix = isContextForm ? `${contextName}.workflow()` : "workflow()";

    if (!firstArg) {
      report(node, `${callPrefix} requires an object literal argument.`);
      return;
    }

    if (!ts.isObjectLiteralExpression(firstArg)) {
      report(firstArg, `${callPrefix} argument must be an object literal.`);
      return;
    }

    const allowedWorkflowCallKeys = new Set([
      "name",
      "args",
      "failureMode",
      "timeoutMs",
      "concurrency",
      "metadata"
    ]);

    for (const prop of firstArg.properties) {
      if (ts.isSpreadAssignment(prop)) {
        report(prop, `${callPrefix} does not support spread properties.`);
        continue;
      }
      if (!ts.isPropertyAssignment(prop)) {
        report(prop, `${callPrefix} does not support shorthand or method properties.`);
        continue;
      }
      if (!ts.isIdentifier(prop.name) && !ts.isStringLiteral(prop.name)) {
        report(prop.name, `${callPrefix} does not support computed property names.`);
        continue;
      }
      const key = prop.name.text;
      if (!allowedWorkflowCallKeys.has(key)) {
        report(prop.name, `${callPrefix} contains unsupported key '${key}'.`);
        continue;
      }

      const init = prop.initializer;
      if (key === "failureMode") {
        if (ts.isStringLiteral(init)) {
          if (init.text !== "throw" && init.text !== "settled") {
            report(init, `failureMode must be 'throw' or 'settled'.`);
          }
        }
      } else if (key === "timeoutMs" || key === "concurrency") {
        if (ts.isNumericLiteral(init)) {
          const val = Number(init.text);
          if (!Number.isInteger(val) || val <= 0) {
            report(init, `${key} must be a positive integer.`);
          }
        } else if (isStaticValue(init)) {
          report(init, `${key} must be a positive integer.`);
        }
      } else if (key === "metadata") {
        if (isStaticValue(init) && !ts.isObjectLiteralExpression(init)) {
          report(init, "metadata must be an object.");
        }
      }
    }

    const nameExpr = getObjectLiteralProperty(firstArg, "name");
    const argsExpr = getObjectLiteralProperty(firstArg, "args");

    if (!nameExpr) {
      report(firstArg, `${callPrefix} is missing required 'name' property.`);
    } else if (ts.isStringLiteral(nameExpr)) {
      const name = nameExpr.text;
      if (isPathLikeWorkflowName(name)) {
        report(nameExpr, "Workflow names must not be path-like.");
      } else if (options.knownWorkflowNames && !options.knownWorkflowNames.has(name)) {
        report(nameExpr, `Workflow '${name}' was not found in the registry.`);
      } else if (options.workflowInputSchemas) {
        const schema = options.workflowInputSchemas.get(name);
        if (schema) {
          validateInputAgainstSchema(name, schema, argsExpr);
        }
      }
    }
  }

  function validateToolCall(node: ts.CallExpression, isContextForm: boolean, isForbiddenContext: boolean, contextName: string = "ctx") {
    const firstArg = node.arguments[0];
    const callPrefix = isContextForm ? `${contextName}.tool()` : "tool()";

    if (isForbiddenContext) {
      report(node, `${callPrefix} is not allowed in this context (parallel, pipeline stage, loop round, or shared agent).`);
    }

    if (!firstArg) {
      report(node, `${callPrefix} requires an object literal argument.`);
      return;
    }

    if (!ts.isObjectLiteralExpression(firstArg)) {
      report(firstArg, `${callPrefix} argument must be an object literal.`);
      return;
    }

    const allowedToolCallKeys = new Set([
      "definition",
      "args",
      "id",
      "label",
      "timeoutMs",
      "failureMode",
      "metadata"
    ]);

    for (const prop of firstArg.properties) {
      if (ts.isSpreadAssignment(prop)) {
        report(prop, `${callPrefix} does not support spread properties.`);
        continue;
      }
      if (!ts.isPropertyAssignment(prop)) {
        report(prop, `${callPrefix} does not support shorthand or method properties.`);
        continue;
      }
      if (!ts.isIdentifier(prop.name) && !ts.isStringLiteral(prop.name)) {
        report(prop.name, `${callPrefix} does not support computed property names.`);
        continue;
      }
      const key = prop.name.text;
      if (!allowedToolCallKeys.has(key)) {
        report(prop.name, `${callPrefix} contains unsupported key '${key}'.`);
        continue;
      }

      const init = prop.initializer;
      if (key === "failureMode") {
        if (ts.isStringLiteral(init)) {
          if (init.text !== "throw" && init.text !== "settled") {
            report(init, `failureMode must be 'throw' or 'settled'.`);
          }
        }
      } else if (key === "timeoutMs") {
        if (ts.isNumericLiteral(init)) {
          const val = Number(init.text);
          if (!Number.isInteger(val) || val <= 0) {
            report(init, `${key} must be a positive integer.`);
          }
        } else if (isStaticValue(init)) {
          report(init, `${key} must be a positive integer.`);
        }
      } else if (key === "metadata") {
        if (isStaticValue(init) && !ts.isObjectLiteralExpression(init)) {
          report(init, "metadata must be an object.");
        }
      }
    }

    const definitionExpr = getObjectLiteralProperty(firstArg, "definition");
    const argsExpr = getObjectLiteralProperty(firstArg, "args");

    if (!definitionExpr) {
      report(firstArg, `${callPrefix} is missing required 'definition' property.`);
    } else if (ts.isStringLiteral(definitionExpr)) {
      const definition = definitionExpr.text;
      if (definition.trim() === "") {
        report(definitionExpr, "Tool definition must not be empty.");
      } else if (definition.includes("/") || definition.includes("\\")) {
        report(definitionExpr, "Tool definition must be a registry ID, not a path.");
      } else {
        const knownToolIds = options.knownToolIds ?? (
          options.toolRegistry
            ? new Set(options.toolRegistry.list().map(t => t.definition.id))
            : undefined
        );
        if (knownToolIds && !knownToolIds.has(definition)) {
          report(definitionExpr, `Tool '${definition}' was not found in the registry.`);
        } else if (options.toolRegistry) {
          const toolDef = options.toolRegistry.get(definition);
          if (toolDef && toolDef.definition.inputSchema) {
            validateInputAgainstSchema(definition, toolDef.definition.inputSchema, argsExpr as ts.Expression);
          }
        }
      }
    } else {
      report(definitionExpr, "Tool definition must be a string literal.");
    }

    if (!argsExpr) {
      report(firstArg, `${callPrefix} is missing required 'args' property.`);
    } else {
      const unsafeReason = hasStaticallyUnsafeJson(argsExpr);
      if (unsafeReason) {
        report(argsExpr, `${callPrefix} 'args' contains non-JSON-safe values: ${unsafeReason}.`);
      }
    }
  }

  function validateLoopCall(
    node: ts.CallExpression,
    isContextForm: boolean,
    contextName: string = "ctx",
    isForbiddenContext: boolean = false,
    functionDepth: number = 0,
    isInsideParallel: boolean = false,
    isInsideLoopRun: boolean = false,
    isInsideMainWorkflow: boolean = false
  ) {
    const callPrefix = isContextForm ? `${contextName}.loop()` : "loop()";

    if (isInsideParallel) {
      report(node, `loop() inside parallel() is not supported to prevent state overwrites.`);
    }
    if (isInsideLoopRun) {
      report(node, `Nested loops are not supported to prevent state overwrites.`);
    }
    if (functionDepth > 0 && !isInsideMainWorkflow && !isInsideLoopRun) {
      report(node, `loop() is not allowed inside helper functions or recursive scopes to prevent state overwrites.`);
    }

    if (node.arguments.length !== 1) {
      report(node, `${callPrefix} now accepts exactly one object argument.`);
      return;
    }

    const firstArg = node.arguments[0];
    if (!firstArg) {
      report(node, `${callPrefix} now accepts exactly one object argument.`);
      return;
    }
    if (!ts.isObjectLiteralExpression(firstArg)) {
      if (isStaticValue(firstArg)) {
        report(firstArg, `${callPrefix} argument must be an object literal.`);
      }
      visit(firstArg, isForbiddenContext, functionDepth, isInsideLoopRun, new Set(), isInsideParallel, isInsideMainWorkflow);
      return;
    }

    const propsMap = new Map<string, ts.Expression | ts.MethodDeclaration>();
    const seenKeys = new Set<string>();

    for (const prop of firstArg.properties) {
      if (ts.isSpreadAssignment(prop)) {
        report(prop, `${callPrefix} does not support spread properties.`);
        continue;
      }
      if (ts.isShorthandPropertyAssignment(prop)) {
        const key = prop.name.text;
        report(prop, `${callPrefix} does not support shorthand property '${key}'.`);
        continue;
      }
      if (ts.isMethodDeclaration(prop)) {
        if (!ts.isIdentifier(prop.name) && !ts.isStringLiteral(prop.name)) {
          report(prop, `${callPrefix} does not support computed method names.`);
          continue;
        }
        const key = prop.name.text;
        if (key !== "run") {
          report(prop, `${callPrefix} does not support method properties for '${key}'.`);
        }
        propsMap.set(key, prop);
        seenKeys.add(key);
        continue;
      }
      if (ts.isPropertyAssignment(prop)) {
        if (!ts.isIdentifier(prop.name) && !ts.isStringLiteral(prop.name)) {
          report(prop, `${callPrefix} does not support computed property names.`);
          continue;
        }
        const key = prop.name.text;
        propsMap.set(key, prop.initializer);
        seenKeys.add(key);
        continue;
      }
      report(prop, `${callPrefix} contains unsupported property type.`);
    }

    const allowedKeys = new Set(["label", "initialState", "options", "run"]);
    for (const key of seenKeys) {
      if (key === "runRound") {
        report(firstArg, `${callPrefix} does not support 'runRound'. Use 'run' instead.`);
      } else if (!allowedKeys.has(key)) {
        report(firstArg, `${callPrefix} contains unsupported top-level key '${key}'.`);
      }
    }

    const requiredKeys = ["label", "initialState", "options", "run"];
    for (const reqKey of requiredKeys) {
      if (!seenKeys.has(reqKey)) {
        report(firstArg, `${callPrefix} is missing required '${reqKey}' property.`);
      }
    }

    const labelInit = propsMap.get("label");
    if (labelInit && isStaticValue(labelInit)) {
      const labelVal = parseStaticProperties(labelInit);
      if (typeof labelVal !== "string") {
        report(labelInit, "label must be a string literal.");
      } else if (labelVal.trim() === "") {
        report(labelInit, "label cannot be empty.");
      } else {
        const normalizedLabel = labelVal
          .toLowerCase()
          .trim()
          .replace(/[^a-z0-9_.:-]+/g, "-")
          .replace(/^-+|-+$/g, "");
        if (loopLabelsSeen.has(normalizedLabel)) {
          report(labelInit, `Duplicate loop label detected: '${labelVal}'. All loop labels in a workflow must be unique.`);
        } else {
          loopLabelsSeen.add(normalizedLabel);
        }
      }
    }

    if (labelInit) {
      visit(labelInit, isForbiddenContext, functionDepth);
    }

    const initialStateInit = propsMap.get("initialState");
    if (initialStateInit) {
      visit(initialStateInit, isForbiddenContext, functionDepth);
    }

    const optionsInit = propsMap.get("options");
    if (optionsInit) {
      if (ts.isObjectLiteralExpression(optionsInit)) {
        const allowedLoopOptionKeys = new Set(["failureMode", "maxRounds", "timeoutMs"]);
        const deprecatedKeys = new Set(["stopWhen", "nextState", "onFailureState", "resultMode", "metadata"]);
        const optPropsMap = new Map<string, ts.Expression>();
        const optSeenKeys = new Set<string>();

        for (const prop of optionsInit.properties) {
          if (ts.isSpreadAssignment(prop)) {
            report(prop, `${callPrefix} does not support spread properties in options.`);
            continue;
          }
          if (!ts.isPropertyAssignment(prop)) {
            report(prop, `${callPrefix} does not support shorthand or method properties in options.`);
            continue;
          }
          if (!ts.isIdentifier(prop.name) && !ts.isStringLiteral(prop.name)) {
            report(prop.name, `${callPrefix} does not support computed property names in options.`);
            continue;
          }
          const key = prop.name.text;
          if (deprecatedKeys.has(key)) {
            report(prop.name, `${callPrefix} option '${key}' is deprecated or unsupported.`);
            continue;
          }
          if (!allowedLoopOptionKeys.has(key)) {
            report(prop.name, `${callPrefix} options contain unsupported key '${key}'.`);
            continue;
          }
          optPropsMap.set(key, prop.initializer);
          optSeenKeys.add(key);
        }

        if (!optSeenKeys.has("maxRounds")) {
          report(optionsInit, `${callPrefix} options is missing required 'maxRounds'.`);
        }

        for (const [key, init] of optPropsMap.entries()) {
          const isStatic = isStaticValue(init);
          const staticVal = isStatic ? parseStaticProperties(init) : undefined;

          if (key === "maxRounds") {
            if (isStatic) {
              const ceiling = options.maxLoopRounds ?? 20;
              if (typeof staticVal !== "number" || isNaN(staticVal) || !Number.isInteger(staticVal) || staticVal < 1) {
                report(init, "maxRounds must be a positive integer.");
              } else if (staticVal > ceiling) {
                report(init, `maxRounds (${staticVal}) exceeds the configured ceiling of ${ceiling}.`);
              }
            }
          } else if (key === "timeoutMs") {
            if (isStatic) {
              if (typeof staticVal !== "number" || isNaN(staticVal) || !Number.isInteger(staticVal) || staticVal <= 0) {
                report(init, "timeoutMs must be a positive integer.");
              }
            }
          } else if (key === "failureMode") {
            if (isStatic) {
              if (typeof staticVal !== "string") {
                report(init, "failureMode must be a string literal.");
              } else if (staticVal !== "throw" && staticVal !== "settled") {
                report(init, "failureMode must be 'throw' or 'settled'.");
              }
            }
          }
        }
      } else if (isStaticValue(optionsInit)) {
        report(optionsInit, `${callPrefix} options must be an object literal.`);
      }

      visit(optionsInit, isForbiddenContext, functionDepth);
    }

    const runInit = propsMap.get("run");
    if (runInit) {
      if (!ts.isArrowFunction(runInit) && !ts.isFunctionExpression(runInit) && !ts.isMethodDeclaration(runInit)) {
        report(runInit, `${callPrefix} 'run' property must be a function expression, arrow function, or method property.`);
      } else {
        const params = runInit.parameters;
        const localLoopContextNames = new Set<string>();
        if (params && params.length >= 2) {
          const secondParam = params[1];
          if (secondParam && ts.isIdentifier(secondParam.name)) {
            localLoopContextNames.add(secondParam.name.text);
          }
        }
        if (localLoopContextNames.size === 0) {
          localLoopContextNames.add("ctx");
          localLoopContextNames.add("context");
        }

        function validateReturnExpression(expr: ts.Expression) {
          let unwrapped = expr;
          while (ts.isParenthesizedExpression(unwrapped)) {
            unwrapped = unwrapped.expression;
          }

          if (ts.isObjectLiteralExpression(unwrapped)) {
            const retKeys = new Set<string>();
            let doneInit: ts.Expression | undefined;

            for (const prop of unwrapped.properties) {
              if (ts.isPropertyAssignment(prop) || ts.isMethodDeclaration(prop)) {
                const propName = ts.isIdentifier(prop.name) || ts.isStringLiteral(prop.name) ? prop.name.text : "";
                if (propName) {
                  retKeys.add(propName);
                  if (propName === "done" && ts.isPropertyAssignment(prop)) {
                    doneInit = prop.initializer;
                  }
                }
              } else if (ts.isShorthandPropertyAssignment(prop)) {
                const propName = prop.name.text;
                retKeys.add(propName);
              }
            }

            if (retKeys.has("result")) {
              report(unwrapped, "Loop run return must not contain 'result'.");
            }
            if (!retKeys.has("done")) {
              report(unwrapped, "Loop run return must contain 'done'.");
            }
            if (!retKeys.has("nextState")) {
              report(unwrapped, "Loop run return must contain 'nextState'.");
            }

            if (doneInit && isStaticValue(doneInit)) {
              const doneVal = parseStaticProperties(doneInit);
              if (typeof doneVal !== "boolean") {
                report(doneInit, "done must be a boolean.");
              }
            }
          }
        }

        function findReturnStatements(n: ts.Node, returns: ts.ReturnStatement[]) {
          if (ts.isReturnStatement(n)) {
            returns.push(n);
            return;
          }
          if (ts.isFunctionDeclaration(n) || ts.isFunctionExpression(n) || ts.isArrowFunction(n) || ts.isMethodDeclaration(n)) {
            return;
          }
          ts.forEachChild(n, child => findReturnStatements(child, returns));
        }

        if (runInit.body) {
          if (ts.isBlock(runInit.body)) {
            const returns: ts.ReturnStatement[] = [];
            findReturnStatements(runInit.body, returns);
            for (const ret of returns) {
              if (ret.expression) {
                validateReturnExpression(ret.expression);
              } else {
                report(ret, "Loop run return must contain 'done' and 'nextState'.");
              }
            }
          } else {
            validateReturnExpression(runInit.body);
          }
        }

        loopRunFunctions.add(runInit);
        visit(runInit, true, functionDepth, true, localLoopContextNames);
      }
    }
  }

  function validateAgentCall(node: ts.CallExpression, isContextForm: boolean, contextName: string = "ctx") {
    const firstArg = node.arguments[0];
    const callPrefix = isContextForm ? `${contextName}.agent()` : "agent()";

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
        } else if (propName === "thinkingEffort" && ts.isPropertyAssignment(prop)) {
          const init = prop.initializer;
          if (ts.isStringLiteral(init)) {
            const val = init.text;
            if (!isThinkingEffort(val)) {
              report(init, `${callPrefix} thinkingEffort must be one of: ${THINKING_EFFORT_VALUES.join(", ")}.`);
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
            report(init, `${callPrefix} thinkingEffort must be a string literal.`);
          }
        }

      }
    }


    if (definitionProp) {
      const definitionArg = ts.isPropertyAssignment(definitionProp) ? definitionProp.initializer : undefined;
      validateSharedAgentId(definitionArg);
      validateSharedAgentInput(definitionArg, firstArg);
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

  function isToolOrCtxTool(node: ts.Node, currentLoopCtxNames?: ReadonlySet<string>): boolean {
    // direct tool
    if (ts.isIdentifier(node) && node.text === "tool") return true;
    
    // ctx.tool
    if (ts.isPropertyAccessExpression(node) && 
        ts.isIdentifier(node.expression) && 
        (contextParameterNames.has(node.expression.text) || (currentLoopCtxNames && currentLoopCtxNames.has(node.expression.text))) && 
        (node.name.text === "tool" || node.name.text === "toolId")) {
      return true;
    }

    // ctx["tool"]
    if (ts.isElementAccessExpression(node) && 
        ts.isIdentifier(node.expression) && 
        (contextParameterNames.has(node.expression.text) || (currentLoopCtxNames && currentLoopCtxNames.has(node.expression.text))) && 
        ts.isStringLiteral(node.argumentExpression) &&
        (node.argumentExpression.text === "tool" || node.argumentExpression.text === "toolId")) {
      return true;
    }

    // tool.bind, tool.call, tool.apply (PropertyAccess)
    // OR tool.bind(null) (CallExpression)
    if (ts.isPropertyAccessExpression(node)) {
      const name = node.name.text;
      if (name === "bind" || name === "call" || name === "apply") {
        if (isToolOrCtxTool(node.expression, currentLoopCtxNames)) return true;
      }
    }

    if (ts.isCallExpression(node)) {
      if (isToolOrCtxTool(node.expression, currentLoopCtxNames)) return true;
    }

    return false;
  }

  function isLikelyWorkflowContext(node: ts.Node, currentLoopCtxNames?: ReadonlySet<string>): boolean {
    if (ts.isIdentifier(node) && (contextParameterNames.has(node.text) || (currentLoopCtxNames && currentLoopCtxNames.has(node.text)))) return true;
    return false;
  }

  function isDirectLoopRunCall(node: ts.Node): boolean {
    let current: ts.Node | undefined = node;
    while (current) {
      if (
        ts.isFunctionDeclaration(current) ||
        ts.isFunctionExpression(current) ||
        ts.isArrowFunction(current) ||
        ts.isMethodDeclaration(current)
      ) {
        return loopRunFunctions.has(current);
      }
      current = current.parent;
    }
    return false;
  }


  function checkBindingForToolAlias(name: ts.BindingName, initializer?: ts.Expression, currentLoopCtxNames?: ReadonlySet<string>) {
    if (ts.isObjectBindingPattern(name)) {
      for (const element of name.elements) {
        const propName = element.propertyName ? (ts.isIdentifier(element.propertyName) ? element.propertyName.text : undefined) : (ts.isIdentifier(element.name) ? element.name.text : undefined);
        if (propName === "tool" || propName === "toolId") {
          // If we have an initializer, check if it's the context.
          // If no initializer (like in parameter), we assume it's aliasing if the parameter looks like a context.
          if (!initializer || isLikelyWorkflowContext(initializer, currentLoopCtxNames)) {
             report(element, "Aliasing tool() is not allowed. Use it directly as tool() or ctx.tool().");
          }
        }
        if (element.name && ts.isObjectBindingPattern(element.name)) {
          checkBindingForToolAlias(element.name, initializer, currentLoopCtxNames);
        }
      }
    }
  }

  function visit(
    node: ts.Node,
    isForbiddenContext: boolean = false,
    functionDepth: number = 0,
    isInsideLoopRun: boolean = false,
    loopContextNames: ReadonlySet<string> = new Set(),
    isInsideParallel: boolean = false,
    isInsideMainWorkflow: boolean = false
  ) {
    // Skip the metadata declaration statement (export const meta = { ... })
    if (sourceFile.statements.length > 0 && node === sourceFile.statements[0]) {
      if (ts.isVariableStatement(node) && node.modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword)) {
        const firstDecl = node.declarationList.declarations[0];
        if (firstDecl && ts.isIdentifier(firstDecl.name) && firstDecl.name.text === "meta") {
          return;
        }
      }
    }

    if (ts.isImportDeclaration(node) || ts.isImportEqualsDeclaration(node)) {
      report(node, "Arbitrary imports are not allowed.");
    }

    let nextForbiddenContext = isForbiddenContext;
    let nextFunctionDepth = functionDepth;
    const nextInsideLoopRun = isInsideLoopRun;
    let nextInsideMainWorkflow = isInsideMainWorkflow;
    const nextLoopContextNames = new Set(loopContextNames);

    if (ts.isVariableDeclaration(node)) {
      const init = node.initializer;
      if (init) {
        if (isToolOrCtxTool(init, nextLoopContextNames)) {
          report(node, "Aliasing tool() is not allowed. Use it directly as tool() or ctx.tool().");
        }
        checkBindingForToolAlias(node.name, init, nextLoopContextNames);
      } else {
        checkBindingForToolAlias(node.name, undefined, nextLoopContextNames);
      }
    }

    if (ts.isParameter(node)) {
      checkBindingForToolAlias(node.name, undefined, nextLoopContextNames);
    }

    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
      const rhs = node.right;
      if (isToolOrCtxTool(rhs, nextLoopContextNames)) {
        report(node, "Aliasing tool() is not allowed. Use it directly as tool() or ctx.tool().");
      }
    }

    if (ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node) || ts.isMethodDeclaration(node)) {
      nextFunctionDepth++;
      if (nextFunctionDepth > 1) {
        nextForbiddenContext = true;
        nextInsideMainWorkflow = false;
      } else if (nextFunctionDepth === 1) {
        // Only the default exported function (the main workflow) is allowed to contain tools.
        let isMainWorkflow = false;
        if (ts.isFunctionDeclaration(node)) {
          isMainWorkflow = !!(node.modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword) && 
                              node.modifiers?.some(m => m.kind === ts.SyntaxKind.DefaultKeyword));
        } else if (ts.isFunctionExpression(node) || ts.isArrowFunction(node)) {
          // Check if it's the expression of an export default
          isMainWorkflow = ts.isExportAssignment(node.parent);
        }
        
        if (!isMainWorkflow) {
          nextForbiddenContext = true;
          nextInsideMainWorkflow = false;
        } else {
          nextInsideMainWorkflow = true;
        }
      }
    }

    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      
      // Reject tool being passed as an argument
      for (const arg of node.arguments) {
        if (isToolOrCtxTool(arg, nextLoopContextNames)) {
          report(arg, "Aliasing tool() is not allowed. Use it directly as tool() or ctx.tool().");
        }
      }

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
                      
                      if (propName === "run") {
                        const runInit = ts.isPropertyAssignment(prop) ? prop.initializer : (ts.isMethodDeclaration(prop) ? prop : undefined);
                        if (runInit) {
                          visit(runInit, true, nextFunctionDepth);
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
          
          // Manual recursion to handle forbidden context for stages
          node.arguments.forEach((arg, idx) => {
            if (idx === 1) {
              // stagesArg and its children (the stage objects and their 'run' methods)
              // need to recursively forbid tools.
              visit(arg, true, nextFunctionDepth, nextInsideLoopRun, nextLoopContextNames, isInsideParallel, false);
            } else {
              visit(arg, nextForbiddenContext, nextFunctionDepth, nextInsideLoopRun, nextLoopContextNames, isInsideParallel, nextInsideMainWorkflow);
            }
          });
          return;
        } else if (calleeText === "parallel") {
          nextForbiddenContext = true;
          node.arguments.forEach((arg) => {
            visit(arg, true, nextFunctionDepth, nextInsideLoopRun, nextLoopContextNames, true, nextInsideMainWorkflow);
          });
          return;
        } else if (calleeText === "loop") {
          validateLoopCall(node, false, "ctx", isForbiddenContext, functionDepth, isInsideParallel, isInsideLoopRun, isInsideMainWorkflow);
          return;
        } else if (calleeText === "defineAgent") {
          const firstArg = node.arguments[0];
          if (firstArg && ts.isObjectLiteralExpression(firstArg)) {
            visit(firstArg, true, nextFunctionDepth, nextInsideLoopRun, nextLoopContextNames, isInsideParallel, false);
            return;
          }
        } else if (calleeText === "agent") {
          validateAgentCall(node, false);
        } else if (calleeText === "workflow") {
          validateWorkflowCall(node, false);
        } else if (calleeText === "tool") {
          validateToolCall(node, false, nextForbiddenContext);
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
        if (ts.isIdentifier(obj)) {
          const isContextParam = contextParameterNames.has(obj.text) || nextLoopContextNames.has(obj.text);
          if (isContextParam) {
            if (prop.text === "agent") {
              validateAgentCall(node, true, obj.text);
            } else if (prop.text === "workflow") {
              validateWorkflowCall(node, true, obj.text);
            } else if (prop.text === "loop") {
              validateLoopCall(node, true, obj.text, isForbiddenContext, functionDepth, isInsideParallel, isInsideLoopRun, isInsideMainWorkflow);
              return;
            } else if (prop.text === "tool") {
              const isDirectLoopTool =
                nextInsideLoopRun &&
                nextLoopContextNames.has(obj.text) &&
                !isInsideParallel &&
                isDirectLoopRunCall(node);
              validateToolCall(node, true, nextForbiddenContext && !isDirectLoopTool, obj.text);
            } else if (prop.text === "toolId" && nextLoopContextNames.has(obj.text)) {
              if (node.arguments.length > 1) {
                report(node, `${obj.text}.toolId() accepts at most one suffix argument.`);
              }
              const suffix = node.arguments[0];
              if (suffix && ts.isStringLiteral(suffix) && !/^[A-Za-z0-9_-]+$/.test(suffix.text)) {
                report(suffix, `${obj.text}.toolId() suffix may contain only alphanumeric characters, underscores, and hyphens.`);
              }
            }
          }
          if (nextLoopContextNames.has(obj.text) || (nextInsideLoopRun && (obj.text === "ctx" || obj.text === "context"))) {
            if (prop.text === "break") {
              report(node, `${obj.text}.break() is not supported inside loop run callback.`);
            } else if (prop.text === "parallel") {
              report(node, `${obj.text}.parallel() is not supported inside loop run callback. Use top-level parallel() around loop task thunks instead.`);
            }
          }
        }
      } else if (ts.isElementAccessExpression(callee)) {
        const obj = callee.expression;
        const arg = callee.argumentExpression;
        if (ts.isIdentifier(obj) && ts.isStringLiteral(arg)) {
          const propName = arg.text;
          const isContextParam = contextParameterNames.has(obj.text) || nextLoopContextNames.has(obj.text);
          if (isContextParam) {
            if (["agent", "workflow", "tool", "toolId"].includes(propName)) {
              report(node, `Computed access forms like ${obj.text}["${propName}"]() are not allowed. Use direct property access like ${obj.text}.${propName}() instead.`);
              if (propName === "agent") {
                validateAgentCall(node, true, obj.text);
              } else if (propName === "workflow") {
                validateWorkflowCall(node, true, obj.text);
              } else if (propName === "tool") {
                validateToolCall(node, true, nextForbiddenContext, obj.text);
              }
            }
          }
          if (nextLoopContextNames.has(obj.text) || (nextInsideLoopRun && (obj.text === "ctx" || obj.text === "context"))) {
            if (propName === "break") {
              report(node, `Computed access forms like ${obj.text}["break"]() are not allowed.`);
            } else if (propName === "parallel") {
              report(node, `${obj.text}.parallel() is not supported inside loop run callback. Use top-level parallel() around loop task thunks instead.`);
            }
          }
        }
      }
      if (callee.kind === ts.SyntaxKind.ImportKeyword) {
        report(node, "Arbitrary imports are not allowed.");
      }
    }

    if (ts.isNewExpression(node)) {
      const expression = node.expression;
      if (ts.isIdentifier(expression) && expression.text === "Date" && (!node.arguments || node.arguments.length === 0)) {
        report(node, "Avoid new Date(): it prevents deterministic resume/cache behavior. Use tool() instead.", "warning");
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
          report(node, "Avoid Date.now(): it prevents deterministic resume/cache behavior. Use tool() instead.", "warning");
        } else if (expr.text === "Math" && name.text === "random") {
          report(node, "Avoid Math.random(): it prevents deterministic resume/cache behavior. Use tool() instead.", "warning");
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

    ts.forEachChild(node, (child) => visit(child, nextForbiddenContext, nextFunctionDepth, nextInsideLoopRun, nextLoopContextNames, isInsideParallel, nextInsideMainWorkflow));
  }

  visit(sourceFile);
  return issues;
}

export function assertWorkflowValid(
  workflow: ParsedWorkflow,
  options: ValidateWorkflowOptions
): void {
  const issues = validateWorkflow(workflow, options);
  const errors = issues.filter((issue) => issue.severity !== "warning");
  const warnings = issues.filter((issue) => issue.severity === "warning");

  if (warnings.length > 0) {
    for (const warning of warnings) {
      console.warn(`Warning: ${warning.message} (at line ${warning.line}, col ${warning.column})`);
    }
  }

  if (errors.length > 0) {
    const summary = errors.map((issue) => `${issue.message}`).join("\n");
    throw new OpenDynamicWorkflowError(
      ErrorCode.WORKFLOW_VALIDATION_ERROR,
      `Workflow validation failed:\n${summary}`
    );
  }
}

export interface DependencyInfo {
  name: string;
  line: number;
  character: number;
}

export function extractWorkflowDependencies(parsed: ParsedWorkflow): DependencyInfo[] {
  const dependencies: DependencyInfo[] = [];
  const sourceFile = ts.createSourceFile(
    parsed.sourcePath,
    parsed.sourceText,
    ts.ScriptTarget.Latest,
    true
  );

  // Find the exported default workflow function to get its context parameter name
  const contextParameterNames = new Set<string>(["ctx", "context"]);
  for (const statement of sourceFile.statements) {
    let workflowFn: ts.FunctionLikeDeclaration | undefined;

    if (ts.isExportAssignment(statement)) {
      const expr = statement.expression;
      if (ts.isFunctionExpression(expr) || ts.isArrowFunction(expr)) {
        workflowFn = expr;
      }
    } else if (ts.isFunctionDeclaration(statement)) {
      const isDefaultExport = statement.modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword) &&
                              statement.modifiers?.some(m => m.kind === ts.SyntaxKind.DefaultKeyword);
      if (isDefaultExport) {
        workflowFn = statement;
      }
    }

    if (workflowFn && workflowFn.parameters.length > 0) {
      const firstParam = workflowFn.parameters[0];
      if (firstParam && ts.isIdentifier(firstParam.name)) {
        contextParameterNames.add(firstParam.name.text);
      }
    }
  }

  function visit(node: ts.Node) {
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      let isWorkflowCall = false;
      if (ts.isIdentifier(callee) && callee.text === "workflow") {
        isWorkflowCall = true;
      } else if (ts.isPropertyAccessExpression(callee)) {
        const obj = callee.expression;
        const prop = callee.name;
        if (ts.isIdentifier(obj) && contextParameterNames.has(obj.text) && prop.text === "workflow") {
          isWorkflowCall = true;
        }
      }

      if (isWorkflowCall && node.arguments.length > 0) {
        const firstArg = node.arguments[0];
        if (firstArg && ts.isObjectLiteralExpression(firstArg)) {
          const nameExpr = getObjectLiteralProperty(firstArg, "name");
          if (nameExpr && ts.isStringLiteral(nameExpr)) {
            const { line, character } = sourceFile.getLineAndCharacterOfPosition(nameExpr.getStart());
            dependencies.push({
              name: nameExpr.text,
              line: line + 1,
              character: character + 1
            });
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return dependencies;
}

export function validateRegistryDependencies(
  registry: WorkflowRegistry,
  options: {
    sharedAgentRegistry?: SharedAgentRegistry | undefined;
    allowDynamicSharedAgentIds?: boolean | undefined;
    toolRegistry?: ToolRegistry | undefined;
    rootWorkflowPath?: string | undefined;
    maxLoopRounds?: number | undefined;
  }
): void {
  const definitions = registry.list();
  
  // 1. Extract dependencies
  const dependencyMap = new Map<string, DependencyInfo[]>();
  for (const def of definitions) {
    const deps = extractWorkflowDependencies(def.parsedWorkflow);
    dependencyMap.set(def.name, deps);
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();
  const validationCache = new Map<string, string[]>(); // Map of workflow name -> validation errors (if any)

  const knownWorkflowNames = registry.names();
  const workflowInputSchemas = registry.inputSchemas();

  // Find root workflow name if rootWorkflowPath is provided
  const rootDef = options.rootWorkflowPath 
    ? definitions.find(d => resolve(d.sourcePath) === resolve(options.rootWorkflowPath!))
    : undefined;
  const rootName = rootDef?.name;

  // DFS function for cycle detection and transitive validation
  function check(
    currentName: string,
    stack: { name: string; sourcePath: string; line?: number; character?: number }[]
  ): string[] {
    if (visiting.has(currentName)) {
      const cycleStartIndex = stack.findIndex(item => item.name === currentName);
      const cycleStack = stack.slice(cycleStartIndex);
      const chainStr = cycleStack
        .map(item => `${item.name} (${item.sourcePath}${item.line ? `:${item.line}:${item.character}` : ""})`)
        .join(" -> ");
      
      throw new OpenDynamicWorkflowError(
        ErrorCode.WORKFLOW_VALIDATION_ERROR,
        `Static recursion cycle detected: ${chainStr} -> ${currentName}`
      );
    }

    if (validationCache.has(currentName)) {
      return validationCache.get(currentName)!;
    }

    if (visited.has(currentName)) {
      return [];
    }

    const def = registry.get(currentName);
    if (!def) {
      return [`Workflow '${currentName}' was not found in the registry.`];
    }

    visiting.add(currentName);

    // 2. Validate current workflow first (using standard validation)
    const issues = validateWorkflow(def.parsedWorkflow, {
      allowImports: false,
      sharedAgentRegistry: options.sharedAgentRegistry,
      knownWorkflowNames,
      workflowInputSchemas,
      allowDynamicSharedAgentIds: options.allowDynamicSharedAgentIds,
      toolRegistry: options.toolRegistry,
      maxLoopRounds: options.maxLoopRounds
    });

    const localErrors = issues.filter(issue => issue.severity !== "warning").map(issue => issue.message);

    // Log warnings for checked workflows. To avoid duplicate warnings for root workflow (which was
    // validated standalone in discovery phase), we skip root if rootName is set.
    if (currentName !== rootName) {
      const warnings = issues.filter(issue => issue.severity === "warning");
      if (warnings.length > 0) {
        for (const warning of warnings) {
          console.warn(`Warning: ${warning.message} (at line ${warning.line}, col ${warning.column})`);
        }
      }
    }

    // 3. Recurse to check dependencies
    const deps = dependencyMap.get(currentName) || [];
    const childErrors: string[] = [];

    for (const dep of deps) {
      const errors = check(dep.name, [
        ...stack,
        {
          name: currentName,
          sourcePath: def.sourcePath,
          line: dep.line,
          character: dep.character
        }
      ]);

      for (const err of errors) {
        childErrors.push(
          `${dep.name} (${def.sourcePath}:${dep.line}:${dep.character}) -> ${err}`
        );
      }
    }

    visiting.delete(currentName);
    visited.add(currentName);

    const allErrors = [...localErrors, ...childErrors];
    validationCache.set(currentName, allErrors);
    return allErrors;
  }

  // Run validation only starting from root workflow if rootDef is found, otherwise fallback to all definitions.
  const allRegistryErrors: string[] = [];
  if (rootDef) {
    const errors = check(rootDef.name, []);
    if (errors.length > 0) {
      allRegistryErrors.push(`Workflow '${rootDef.name}' validation failed:\n` + errors.map(e => `  - ${e}`).join("\n"));
    }
  } else {
    for (const def of definitions) {
      const errors = check(def.name, []);
      if (errors.length > 0) {
        allRegistryErrors.push(`Workflow '${def.name}' validation failed:\n` + errors.map(e => `  - ${e}`).join("\n"));
      }
    }
  }

  if (allRegistryErrors.length > 0) {
    throw new OpenDynamicWorkflowError(
      ErrorCode.WORKFLOW_VALIDATION_ERROR,
      allRegistryErrors.join("\n\n")
    );
  }
}
