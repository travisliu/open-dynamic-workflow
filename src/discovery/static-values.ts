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

export function parseSourceFile(filePath: string, sourceText: string): ts.SourceFile {
  return ts.createSourceFile(filePath, sourceText, ts.ScriptTarget.Latest, true);
}

export function extractStaticValue(node: ts.Node): StaticValueResult {
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
    const operandResult = extractStaticValue(node.operand);
    if (operandResult.ok && typeof operandResult.value === "number") {
      return { ok: true, value: -operandResult.value };
    }
    return { ok: false, message: "Unsupported unary expression" };
  }

  if (ts.isArrayLiteralExpression(node)) {
    const values: StaticValue[] = [];
    for (const element of node.elements) {
      if (ts.isSpreadElement(element)) {
        return { ok: false, message: "Spread elements are not supported" };
      }
      const result = extractStaticValue(element);
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

      const valueResult = extractStaticValue(property.initializer);
      if (!valueResult.ok) return valueResult;
      obj[key] = valueResult.value;
    }
    return { ok: true, value: obj };
  }

  return { ok: false, message: `Unsupported node type: ${ts.SyntaxKind[node.kind]}` };
}
