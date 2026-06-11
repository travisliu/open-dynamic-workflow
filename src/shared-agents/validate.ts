import AjvModule from "ajv";
import * as ts from "typescript";
import { ErrorCode } from "../errors/codes.js";
import { OpenFlowError } from "../errors/types.js";
import type { JsonSchema } from "../types/common.js";
import type {
  SharedAgentDefinition,
} from "./types.js";

const Ajv = (AjvModule as any).default || AjvModule;
const ajv = new Ajv({ allErrors: true });

const ID_REGEX = /^[a-z0-9][a-z0-9-_.]*$/;

export interface SharedAgentValidationOptions {
  strictPromptTemplateVariables?: boolean;
}

export function validateSharedAgentDefinition(
  definition: unknown,
  sourcePath: string,
  options: SharedAgentValidationOptions = {}
): SharedAgentDefinition {
  if (!definition || typeof definition !== "object") {
    throw new OpenFlowError(
      ErrorCode.SHARED_AGENT_INVALID_DEFINITION,
      `Shared agent definition in ${sourcePath} must be an object.`
    );
  }

  const def = definition as Record<string, unknown>;

  // Validate ID
  if (typeof def.id !== "string" || !ID_REGEX.test(def.id)) {
    throw new OpenFlowError(
      ErrorCode.SHARED_AGENT_INVALID_DEFINITION,
      `Shared agent in ${sourcePath} has invalid id '${def.id}'. IDs must match ${ID_REGEX}.`
    );
  }

  // Validate description
  if (def.description !== undefined && typeof def.description !== "string") {
    throw new OpenFlowError(
      ErrorCode.SHARED_AGENT_INVALID_DEFINITION,
      `Shared agent in ${sourcePath} has invalid description. If provided, it must be a string.`
    );
  }

  // Validate run
  if (typeof def.run !== "function") {
    throw new OpenFlowError(
      ErrorCode.SHARED_AGENT_INVALID_DEFINITION,
      `Shared agent in ${sourcePath} must have a 'run' function.`
    );
  }

  // Validate JSON schemas
  if (def.inputSchema !== undefined) {
    validateSchema(def.inputSchema, "inputSchema", sourcePath);
  }
  if (def.schema !== undefined) {
    validateSchema(def.schema, "schema", sourcePath);
  }

  if (def.agentPrompt !== undefined) {
    if (typeof def.agentPrompt !== "string") {
      throw new OpenFlowError(
        ErrorCode.SHARED_AGENT_INVALID_DEFINITION,
        `Shared agent in ${sourcePath} has invalid agentPrompt. If provided, it must be a string.`
      );
    }
    const sharedDef = def as unknown as SharedAgentDefinition;
    if (options.strictPromptTemplateVariables) {
      validatePromptVariables(sharedDef, sourcePath);
    }
  }

  return def as unknown as SharedAgentDefinition;
}

function validateSchema(schema: unknown, fieldName: string, sourcePath: string): void {
  if (!schema || typeof schema !== "object") {
    throw new OpenFlowError(
      ErrorCode.SHARED_AGENT_INVALID_DEFINITION,
      `Shared agent in ${sourcePath} has invalid ${fieldName}. It must be an object.`
    );
  }
  try {
    ajv.compile(schema as JsonSchema);
  } catch (err) {
    throw new OpenFlowError(
      ErrorCode.SHARED_AGENT_INVALID_DEFINITION,
      `Shared agent in ${sourcePath} has invalid ${fieldName}: ${(err as Error).message}`
    );
  }
}

function validatePromptVariables(
  def: SharedAgentDefinition,
  sourcePath: string
): void {
  if (!def.agentPrompt) return;

  const matches = def.agentPrompt.matchAll(/\{\{([^}]+)\}\}/g);
  const variables = new Set<string>();
  for (const match of matches) {
    if (match[1]) {
      variables.add(match[1].trim());
    }
  }

  if (variables.size === 0) return;

  const inputProperties = (def.inputSchema?.properties as Record<string, unknown>) || {};
  const declaredVariables = new Set(Object.keys(inputProperties));

  for (const variable of variables) {
    if (!declaredVariables.has(variable)) {
      throw new OpenFlowError(
        ErrorCode.SHARED_AGENT_UNDECLARED_PROMPT_VARIABLE,
        `Shared agent '${def.id}' in ${sourcePath} uses undeclared prompt variable '{{${variable}}}'.`
      );
    }
  }
}

export function validateSharedAgentSource(
  sourceText: string,
  sourcePath: string
): void {
  const sourceFile = ts.createSourceFile(
    sourcePath,
    sourceText,
    ts.ScriptTarget.Latest,
    true
  );

  const forbiddenIdentifiers = new Set([
    "globalThis",
    "global",
    "window",
    "self",
    "fetch",
    "eval",
    "Function",
    "Object",
    "Reflect",
    "Proxy",
    "AsyncFunction",
    "process",
    "fs",
    "path",
    "os",
    "child_process",
    "net",
    "http",
    "https",
    "shell",
    "phase",
    "parallel",
    "pipeline",
    "args",
  ]);

  const forbiddenProperties = new Set([
    "constructor",
    "__proto__",
    "prototype",
    "Function",
    "fs",
    "path",
    "os",
    "child_process",
    "net",
    "http",
    "https",
    "shell",
    "process",
    "fetch",
    "Object",
    "Reflect",
    "Proxy",
    "AsyncFunction",
    "phase",
    "parallel",
    "pipeline",
    "args",
  ]);

  function report(node: ts.Node, message: string) {
    throw new OpenFlowError(ErrorCode.SHARED_AGENT_SECURITY_POLICY_VIOLATION, message);
  }

  function staticStringValue(node: ts.Node): string | null {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      return node.text;
    }
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
      const left = staticStringValue(node.left);
      const right = staticStringValue(node.right);
      if (left !== null && right !== null) {
        return left + right;
      }
    }
    return null;
  }

  function visit(node: ts.Node) {
    if (ts.isImportDeclaration(node) || ts.isImportEqualsDeclaration(node)) {
      let isAllowed = false;
      if (ts.isImportDeclaration(node)) {
        if (node.importClause?.isTypeOnly) {
          isAllowed = true;
        } else {
          const moduleSpecifier = node.moduleSpecifier;
          if (ts.isStringLiteral(moduleSpecifier)) {
            const val = moduleSpecifier.text;
            if (val === "@prmflow/openflow" || val.includes("define-agent")) {
              isAllowed = true;
            }
          }
        }
      }
      if (!isAllowed) {
        report(node, `Arbitrary imports are not allowed in shared agent: ${sourcePath}`);
      }
    }

    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      if (ts.isIdentifier(callee)) {
        const calleeText = callee.text;
        if (calleeText === "require") {
          report(node, `require() is not supported in shared agent: ${sourcePath}`);
        }
      }
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword) {
        report(node, `Dynamic import() is not supported in shared agent: ${sourcePath}`);
      }
    }

    if (node.kind === ts.SyntaxKind.ThisKeyword) {
      report(node, `'this' keyword is not allowed in shared agent to prevent sandbox escapes: ${sourcePath}`);
    }

    if (ts.isIdentifier(node)) {
      if (forbiddenIdentifiers.has(node.text)) {
        report(
          node,
          `Access to restricted identifier '${node.text}' is not allowed in shared agent: ${sourcePath}`
        );
      }
    }

    if (ts.isPropertyAccessExpression(node)) {
      const propName = node.name.text;
      if (forbiddenProperties.has(propName)) {
        report(
          node,
          `Access to restricted property '${propName}' is not allowed in shared agent: ${sourcePath}`
        );
      }
    }

    if (ts.isElementAccessExpression(node)) {
      const arg = node.argumentExpression;
      const resolvedValue = staticStringValue(arg);
      if (resolvedValue === null) {
        report(
          node,
          `Dynamic element access is not allowed in shared agent to prevent security bypasses: ${sourcePath}`
        );
      } else if (forbiddenProperties.has(resolvedValue)) {
        report(
          node,
          `Access to restricted property '${resolvedValue}' via element access is not allowed in shared agent: ${sourcePath}`
        );
      }
    }

    ts.forEachChild(node, visit);
  }

  ts.forEachChild(sourceFile, visit);
}

export function validateSharedAgentInput(
  definition: SharedAgentDefinition,
  input: unknown
): Record<string, unknown> {
  if (input === undefined) return {};

  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new OpenFlowError(
      ErrorCode.SHARED_AGENT_CONTEXT_VALIDATION_FAILED,
      "Shared agent context must be an object."
    );
  }

  const ctx = input as Record<string, unknown>;

  if (ctx.subPrompt !== undefined) {
    throw new OpenFlowError(
      ErrorCode.SHARED_AGENT_CONTEXT_VALIDATION_FAILED,
      "Context field 'subPrompt' is deprecated and restricted. Use 'prompt' instead."
    );
  }

  if (definition.inputSchema) {
    const validate = ajv.compile(definition.inputSchema);
    const valid = validate(ctx);
    if (!valid) {
      const error = ajv.errorsText(validate.errors);
      throw new OpenFlowError(
        ErrorCode.SHARED_AGENT_CONTEXT_VALIDATION_FAILED,
        `Shared agent context validation failed: ${error}`
      );
    }
  }

  return ctx;
}
