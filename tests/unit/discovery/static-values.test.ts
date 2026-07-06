import { describe, it, expect } from "vitest";
import { parseSourceFile, extractStaticValue } from "../../../src/discovery/static-values.js";

describe("static-values", () => {
  it("extracts basic literals", () => {
    const source = `
      const s = "hello";
      const n = 123;
      const b1 = true;
      const b2 = false;
      const nul = null;
    `;
    const sf = parseSourceFile("test.ts", source);
    
    // @ts-ignore - accessing internal statements for test
    expect(extractStaticValue(sf.statements[0].declarationList.declarations[0].initializer)).toEqual({ ok: true, value: "hello" });
    // @ts-ignore
    expect(extractStaticValue(sf.statements[1].declarationList.declarations[0].initializer)).toEqual({ ok: true, value: 123 });
    // @ts-ignore
    expect(extractStaticValue(sf.statements[2].declarationList.declarations[0].initializer)).toEqual({ ok: true, value: true });
    // @ts-ignore
    expect(extractStaticValue(sf.statements[3].declarationList.declarations[0].initializer)).toEqual({ ok: true, value: false });
    // @ts-ignore
    expect(extractStaticValue(sf.statements[4].declarationList.declarations[0].initializer)).toEqual({ ok: true, value: null });
  });

  it("extracts negative numbers", () => {
    const source = `const n = -456;`;
    const sf = parseSourceFile("test.ts", source);
    // @ts-ignore
    expect(extractStaticValue(sf.statements[0].declarationList.declarations[0].initializer)).toEqual({ ok: true, value: -456 });
  });

  it("extracts no-substitution template literals", () => {
    const source = "const s = `world`;";
    const sf = parseSourceFile("test.ts", source);
    // @ts-ignore
    expect(extractStaticValue(sf.statements[0].declarationList.declarations[0].initializer)).toEqual({ ok: true, value: "world" });
  });

  it("extracts arrays", () => {
    const source = `const a = ["a", 1, true];`;
    const sf = parseSourceFile("test.ts", source);
    // @ts-ignore
    expect(extractStaticValue(sf.statements[0].declarationList.declarations[0].initializer)).toEqual({ ok: true, value: ["a", 1, true] });
  });

  it("extracts nested objects", () => {
    const source = `
      const obj = {
        name: "test",
        "key-with-dash": 123,
        nested: {
          active: true
        },
        list: [null]
      };
    `;
    const sf = parseSourceFile("test.ts", source);
    // @ts-ignore
    expect(extractStaticValue(sf.statements[0].declarationList.declarations[0].initializer)).toEqual({
      ok: true,
      value: {
        name: "test",
        "key-with-dash": 123,
        nested: {
          active: true
        },
        list: [null]
      }
    });
  });

  it("resolves earlier same-file const references with context", () => {
    const source = `
      const fragment = { type: "object" };
      const schema = fragment;
    `;
    const sf = parseSourceFile("test.ts", source);
    // @ts-ignore
    const result = extractStaticValue(sf.statements[1].declarationList.declarations[0].initializer, { sourceFile: sf });

    expect(result).toEqual({ ok: true, value: { type: "object" } });
  });

  it("resolves earlier declarations in the same const statement", () => {
    const source = `const fragment = { type: "object" }, schema = fragment;`;
    const sf = parseSourceFile("test.ts", source);
    // @ts-ignore
    const result = extractStaticValue(sf.statements[0].declarationList.declarations[1].initializer, { sourceFile: sf });

    expect(result).toEqual({ ok: true, value: { type: "object" } });
  });

  it("rejects later same-file const references with context", () => {
    const source = `
      const schema = fragment;
      const fragment = { type: "object" };
    `;
    const sf = parseSourceFile("test.ts", source);
    // @ts-ignore
    const result = extractStaticValue(sf.statements[0].declarationList.declarations[0].initializer, { sourceFile: sf });

    expect(result.ok).toBe(false);
  });

  it("rejects later declarations in the same const statement", () => {
    const source = `const schema = fragment, fragment = { type: "object" };`;
    const sf = parseSourceFile("test.ts", source);
    // @ts-ignore
    const result = extractStaticValue(sf.statements[0].declarationList.declarations[0].initializer, { sourceFile: sf });

    expect(result.ok).toBe(false);
  });

  it("rejects non-static values", () => {
    const testCases = [
      "const x = someVar;",
      "const x = fn();",
      "const x = () => {};",
      "const x = [...arr];",
      "const x = { [comp]: 1 };",
      "const x = `template ${sub}`;",
      "const x = obj.prop;",
      "const x = process.env.NODE_ENV;"
    ];

    for (const source of testCases) {
      const sf = parseSourceFile("test.ts", source);
      // @ts-ignore
      const result = extractStaticValue(sf.statements[0].declarationList.declarations[0].initializer);
      expect(result.ok).toBe(false);
    }
  });
});
