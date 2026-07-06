import ts from "typescript";

export type StaticValue =
  | string
  | number
  | boolean
  | null
  | StaticValue[]
  | { [key: string]: StaticValue };

export type StaticValueResult =
  | { ok: true; value: StaticValue }
  | { ok: false; message: string };

interface StaticResolutionContext {
  sourceFile: ts.SourceFile;
}

interface StaticDeclaration {
  initializer: ts.Expression;
  initializedAt: number;
}

interface ResolverState {
  declarations: Map<string, StaticDeclaration>;
  resolving: Set<string>;
  sourceFile: ts.SourceFile;
}

export function parseSourceFile(filePath: string, sourceText: string): ts.SourceFile {
  return ts.createSourceFile(filePath, sourceText, ts.ScriptTarget.Latest, true);
}

function collectTopLevelConstDeclarations(sourceFile: ts.SourceFile): Map<string, StaticDeclaration> {
  const declarations = new Map<string, StaticDeclaration>();

  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) {
      continue;
    }

    const isConst = (statement.declarationList.flags & ts.NodeFlags.Const) !== 0;
    if (!isConst) {
      continue;
    }

    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || !declaration.initializer) {
        continue;
      }

      declarations.set(declaration.name.text, {
        initializer: declaration.initializer,
        initializedAt: declaration.initializer.end,
      });
    }
  }

  return declarations;
}

function createResolverState(context?: StaticResolutionContext): ResolverState | undefined {
  if (!context) {
    return undefined;
  }

  return {
    declarations: collectTopLevelConstDeclarations(context.sourceFile),
    resolving: new Set<string>(),
    sourceFile: context.sourceFile,
  };
}

function extractStaticValueInternal(
  node: ts.Node,
  context?: StaticResolutionContext,
  state?: ResolverState
): StaticValueResult {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return { ok: true, value: node.text };
  }

  if (ts.isNumericLiteral(node)) {
    return { ok: true, value: Number(node.text) };
  }

  if (node.kind === ts.SyntaxKind.TrueKeyword) {
    return { ok: true, value: true };
  }

  if (node.kind === ts.SyntaxKind.FalseKeyword) {
    return { ok: true, value: false };
  }

  if (node.kind === ts.SyntaxKind.NullKeyword) {
    return { ok: true, value: null };
  }

  // Handle negative numbers (PrefixUnaryExpression with MinusToken)
  if (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.MinusToken) {
    const operandResult = extractStaticValueInternal(node.operand, context, state);
    if (operandResult.ok && typeof operandResult.value === "number") {
      return { ok: true, value: -operandResult.value };
    }
    return { ok: false, message: "Unsupported unary expression" };
  }

  if (ts.isIdentifier(node)) {
    if (!state) {
      return { ok: false, message: `Unsupported node type: ${ts.SyntaxKind[node.kind]}` };
    }

    const declaration = state.declarations.get(node.text);
    if (!declaration) {
      return { ok: false, message: `Unresolved identifier: ${node.text}` };
    }

    if (declaration.initializedAt > node.getStart(state.sourceFile)) {
      return { ok: false, message: `Identifier '${node.text}' is referenced before initialization` };
    }

    if (state.resolving.has(node.text)) {
      return { ok: false, message: `Circular identifier reference: ${node.text}` };
    }

    state.resolving.add(node.text);
    try {
      return extractStaticValueInternal(declaration.initializer, context, state);
    } finally {
      state.resolving.delete(node.text);
    }
  }

  if (ts.isArrayLiteralExpression(node)) {
    const values: StaticValue[] = [];
    for (const element of node.elements) {
      if (ts.isSpreadElement(element)) {
        return { ok: false, message: "Spread elements are not supported" };
      }
      const result = extractStaticValueInternal(element, context, state);
      if (!result.ok) return result;
      values.push(result.value);
    }
    return { ok: true, value: values };
  }

  if (ts.isObjectLiteralExpression(node)) {
    const obj: { [key: string]: StaticValue } = {};
    for (const property of node.properties) {
      if (!ts.isPropertyAssignment(property)) {
        return { ok: false, message: "Unsupported property type (only literal property assignments are allowed)" };
      }

      const keyNode = property.name;
      let key: string;

      if (ts.isIdentifier(keyNode)) {
        key = keyNode.text;
      } else if (ts.isStringLiteral(keyNode)) {
        key = keyNode.text;
      } else {
        return { ok: false, message: "Unsupported key type (only identifiers and strings are allowed)" };
      }

      const valueResult = extractStaticValueInternal(property.initializer, context, state);
      if (!valueResult.ok) return valueResult;
      obj[key] = valueResult.value;
    }
    return { ok: true, value: obj };
  }

  if (ts.isPropertyAccessExpression(node)) {
    const targetResult = extractStaticValueInternal(node.expression, context, state);
    if (!targetResult.ok) {
      return targetResult;
    }

    if (
      targetResult.value === null ||
      typeof targetResult.value !== "object" ||
      Array.isArray(targetResult.value)
    ) {
      return { ok: false, message: `Property access target is not an object: ${node.expression.getText()}` };
    }

    if (!Object.prototype.hasOwnProperty.call(targetResult.value, node.name.text)) {
      return { ok: false, message: `Property '${node.name.text}' not found` };
    }

    return {
      ok: true,
      value: (targetResult.value as Record<string, StaticValue>)[node.name.text]!
    };
  }

  return { ok: false, message: `Unsupported node type: ${ts.SyntaxKind[node.kind]}` };
}

export function extractStaticValue(node: ts.Node, context?: StaticResolutionContext): StaticValueResult {
  return extractStaticValueInternal(node, context, createResolverState(context));
}
