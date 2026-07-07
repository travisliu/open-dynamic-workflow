import { describe, it, expect } from "vitest";
import ts from "typescript";
import { parseSourceFile, extractStaticValue } from "../../../src/discovery/static-values.js";

function initializerAt(sourceFile: ts.SourceFile, statementIndex: number): ts.Expression {
  const statement = sourceFile.statements[statementIndex];
  if (!ts.isVariableStatement(statement)) {
    throw new Error(`Expected variable statement at index ${statementIndex}`);
  }

  const declaration = statement.declarationList.declarations[0];
  if (!declaration.initializer) {
    throw new Error(`Expected initializer at index ${statementIndex}`);
  }

  return declaration.initializer;
}

describe("static-values-regression", () => {
  it("resolves earlier same-file consts without explicit context", () => {
    // Arrange
    const source = `
      const fragment = { type: "object" };
      const schema = fragment;
    `;
    const sourceFile = parseSourceFile("test.ts", source);
    const schemaInitializer = initializerAt(sourceFile, 1);

    // Act
    const resolved = extractStaticValue(schemaInitializer);

    // Assert
    expect(resolved).toEqual({ ok: true, value: { type: "object" } });
  });

  it("rejects same-file consts that are referenced before initialization", () => {
    // Arrange
    const source = `
      const schema = fragment;
      const fragment = { type: "object" };
    `;
    const sourceFile = parseSourceFile("test.ts", source);
    const schemaInitializer = initializerAt(sourceFile, 0);

    // Act
    const result = extractStaticValue(schemaInitializer);

    // Assert
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("referenced before initialization");
    }
  });

  it("rejects circular same-file const references", () => {
    // Arrange
    const source = `
      const circularA = circularB;
      const circularB = circularA;
    `;
    const sourceFile = parseSourceFile("test.ts", source);
    const circularInitializer = initializerAt(sourceFile, 0);

    // Act
    const result = extractStaticValue(circularInitializer);

    // Assert
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("referenced before initialization");
    }
  });

  it("unwraps recursive wrapper nodes before static evaluation", () => {
    // Arrange
    const source = `
      const value = (<Record<string, unknown>>(({
        type: "object"
      } as const) satisfies Record<string, unknown>));
    `;
    const sourceFile = parseSourceFile("test.ts", source);
    const valueInitializer = initializerAt(sourceFile, 0);

    // Act
    const result = extractStaticValue(valueInitializer);

    // Assert
    expect(result).toEqual({ ok: true, value: { type: "object" } });
  });

  it("preserves __proto__ as an own data key on null-prototype objects", () => {
    // Arrange
    const source = `
      const value = {
        "__proto__": { polluted: true },
        constructor: "safe"
      };
    `;
    const sourceFile = parseSourceFile("test.ts", source);
    const valueInitializer = initializerAt(sourceFile, 0);

    // Act
    const result = extractStaticValue(valueInitializer);

    // Assert
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(Object.getPrototypeOf(result.value)).toBe(null);
      expect(Object.prototype.hasOwnProperty.call(result.value, "__proto__")).toBe(true);
      expect((result.value as Record<string, unknown>)["__proto__"]).toEqual({ polluted: true });
    }
  });

  it("rejects non-finite numbers", () => {
    // Arrange
    const source = `
      const positive = 1e999;
      const negative = -1e999;
      const finite = 123.5;
    `;
    const sourceFile = parseSourceFile("test.ts", source);
    const positiveInitializer = initializerAt(sourceFile, 0);
    const negativeInitializer = initializerAt(sourceFile, 1);
    const finiteInitializer = initializerAt(sourceFile, 2);

    // Act
    const positiveResult = extractStaticValue(positiveInitializer);
    const negativeResult = extractStaticValue(negativeInitializer);
    const finiteResult = extractStaticValue(finiteInitializer);

    // Assert
    expect(positiveResult.ok).toBe(false);
    if (!positiveResult.ok) {
      expect(positiveResult.message).toContain("Numeric literal is not finite");
    }
    expect(negativeResult.ok).toBe(false);
    if (!negativeResult.ok) {
      expect(negativeResult.message).toContain("Numeric literal is not finite");
    }
    expect(finiteResult).toEqual({ ok: true, value: 123.5 });
  });

  it("rejects unsupported dynamic constructs without executing user code", () => {
    // Arrange
    const source = `
      const explode = () => {
        throw new Error("executed");
      };
      const value = explode();
    `;
    const sourceFile = parseSourceFile("test.ts", source);
    const valueInitializer = initializerAt(sourceFile, 1);

    // Act
    const result = extractStaticValue(valueInitializer);

    // Assert
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("Unsupported node type: CallExpression");
    }
  });
});
