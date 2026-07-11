import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import * as fs from "node:fs";
import { activeToolRuntimeApi } from "../../../src/tools/runtime-api.js";
import { createToolRuntimeGlobalLock } from "../../../src/tools/runtime-global-lock.js";
import { loadMirroredToolModules } from "../../../src/tools/runtime-module-loader.js";
import { prepareToolRuntimePackageShim } from "../../../src/tools/runtime-package-shim.js";
import { ErrorCode } from "../../../src/errors/codes.js";
import { OpenDynamicWorkflowError } from "../../../src/errors/types.js";

describe("runtime-module-loader", () => {
  let tempBaseDir: string;
  let originalDescriptor: PropertyDescriptor | undefined;

  beforeEach(async () => {
    tempBaseDir = await mkdtemp(join(tmpdir(), "odw-loader-test-"));
    originalDescriptor = Object.getOwnPropertyDescriptor(globalThis, "defineTool");
  });

  afterEach(async () => {
    if (originalDescriptor) {
      Object.defineProperty(globalThis, "defineTool", originalDescriptor);
    } else {
      // @ts-ignore
      delete globalThis.defineTool;
    }
    // Clean up test globals
    delete (globalThis as any).__loaderTestEvents;
    delete (globalThis as any).__loaderTestGate;
    delete (globalThis as any).__loaderTestStartedA;
    
    await rm(tempBaseDir, { recursive: true, force: true });
  });

  it("should load a no-import defineTool candidate, verify brand, and clean up globals", async () => {
    const lock = createToolRuntimeGlobalLock();
    const candidatePath = join(tempBaseDir, "tool1.mjs");
    await writeFile(
      candidatePath,
      `export default defineTool({ id: "tool1", description: "desc1", inputSchema: {}, run: () => "result1" });`
    );

    const results = await loadMirroredToolModules({
      lock,
      runtimeApi: activeToolRuntimeApi,
      candidates: [
        {
          sourcePath: "/original/path/tool1.ts",
          relativePath: "tool1.ts",
          modulePath: candidatePath,
        },
      ],
    });

    expect(results).toHaveLength(1);
    expect(results[0].definition.id).toBe("tool1");
    expect(results[0].sourcePath).toBe("/original/path/tool1.ts");

    // Brand check
    const BRAND = Symbol.for("open-dynamic-workflow.toolDefinition");
    expect((results[0].definition as any)[BRAND]).toBe(true);

    // Global cleanup check
    expect(Object.prototype.hasOwnProperty.call(globalThis, "defineTool")).toBe(false);
  });

  it("should load a legacy-import candidate when shim is prepared in a temp ancestor", async () => {
    const lock = createToolRuntimeGlobalLock();
    // Prepare the node_modules compatibility shim in the temp root
    await prepareToolRuntimePackageShim({ tempDir: tempBaseDir });

    const candidatePath = join(tempBaseDir, "legacy-tool.mjs");
    await writeFile(
      candidatePath,
      `import { defineTool } from "@travisliu/open-dynamic-workflow";
export default defineTool({ id: "legacy", description: "desc", inputSchema: {}, run: () => {} });`
    );

    const results = await loadMirroredToolModules({
      lock,
      runtimeApi: activeToolRuntimeApi,
      candidates: [
        {
          sourcePath: "/original/path/legacy.ts",
          relativePath: "legacy.ts",
          modulePath: candidatePath,
        },
      ],
    });

    expect(results).toHaveLength(1);
    expect(results[0].definition.id).toBe("legacy");
  });

  it("should invoke diagnostic callback for a legacy-import candidate upon successful load", async () => {
    const lock = createToolRuntimeGlobalLock();
    await prepareToolRuntimePackageShim({ tempDir: tempBaseDir });

    const candidatePath = join(tempBaseDir, "legacy-tool-diag.mjs");
    await writeFile(
      candidatePath,
      `import { defineTool } from "@travisliu/open-dynamic-workflow";
export default defineTool({ id: "legacy-diag", description: "desc", inputSchema: {}, run: () => {} });`
    );

    const diagnostics: any[] = [];
    const results = await loadMirroredToolModules({
      lock,
      runtimeApi: activeToolRuntimeApi,
      onLegacyRuntimeImport: (info) => {
        diagnostics.push(info);
      },
      candidates: [
        {
          sourcePath: "/original/path/legacy-diag.ts",
          relativePath: "legacy-diag.ts",
          modulePath: candidatePath,
          isLegacyImport: true,
        },
      ],
    });

    expect(results).toHaveLength(1);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toEqual({
      sourcePath: "/original/path/legacy-diag.ts",
      relativePath: "legacy-diag.ts",
    });
  });

  it("should not invoke diagnostic callback for a no-import candidate", async () => {
    const lock = createToolRuntimeGlobalLock();
    const candidatePath = join(tempBaseDir, "no-import-tool.mjs");
    await writeFile(
      candidatePath,
      `export default defineTool({ id: "no-import", description: "desc", inputSchema: {}, run: () => {} });`
    );

    const diagnostics: any[] = [];
    const results = await loadMirroredToolModules({
      lock,
      runtimeApi: activeToolRuntimeApi,
      onLegacyRuntimeImport: (info) => {
        diagnostics.push(info);
      },
      candidates: [
        {
          sourcePath: "/original/path/no-import.ts",
          relativePath: "no-import.ts",
          modulePath: candidatePath,
          isLegacyImport: false,
        },
      ],
    });

    expect(results).toHaveLength(1);
    expect(diagnostics).toHaveLength(0);
  });

  it("should not invoke diagnostic callback if evaluation/brand validation fails", async () => {
    const lock = createToolRuntimeGlobalLock();
    const candidatePath = join(tempBaseDir, "invalid-brand.mjs");
    await writeFile(
      candidatePath,
      `export default { id: "invalid", description: "desc", inputSchema: {}, run: () => {} };`
    );

    const diagnostics: any[] = [];
    await expect(
      loadMirroredToolModules({
        lock,
        runtimeApi: activeToolRuntimeApi,
        onLegacyRuntimeImport: (info) => {
          diagnostics.push(info);
        },
        candidates: [
          {
            sourcePath: "/original/path/invalid.ts",
            relativePath: "invalid.ts",
            modulePath: candidatePath,
            isLegacyImport: true,
          },
        ],
      })
    ).rejects.toThrow();

    expect(diagnostics).toHaveLength(0);
  });

  it("should not let a throwing diagnostic callback break the load session or cleanup", async () => {
    const lock = createToolRuntimeGlobalLock();
    await prepareToolRuntimePackageShim({ tempDir: tempBaseDir });

    const candidatePath = join(tempBaseDir, "throwing-diag.mjs");
    await writeFile(
      candidatePath,
      `import { defineTool } from "@travisliu/open-dynamic-workflow";
export default defineTool({ id: "throwing-diag", description: "desc", inputSchema: {}, run: () => {} });`
    );

    const results = await loadMirroredToolModules({
      lock,
      runtimeApi: activeToolRuntimeApi,
      onLegacyRuntimeImport: () => {
        throw new Error("Diagnostic callback error");
      },
      candidates: [
        {
          sourcePath: "/original/path/throwing.ts",
          relativePath: "throwing.ts",
          modulePath: candidatePath,
          isLegacyImport: true,
        },
      ],
    });

    expect(results).toHaveLength(1);
    expect(results[0].definition.id).toBe("throwing-diag");
    // Verify global cleanup completed successfully
    expect(Object.prototype.hasOwnProperty.call(globalThis, "defineTool")).toBe(false);
  });

  it("should load multiple candidates sequentially and preserve input order", async () => {
    function createDeferred<T = void>() {
      let resolve!: (value: T | PromiseLike<T>) => void;
      let reject!: (reason?: any) => void;
      const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
      });
      return { promise, resolve, reject };
    }

    const lock = createToolRuntimeGlobalLock();
    const c1 = join(tempBaseDir, "tool-a.mjs");
    const c2 = join(tempBaseDir, "tool-b.mjs");

    const loaderTestEvents: string[] = [];
    const loaderTestGate = createDeferred<void>();
    const loaderTestStartedA = createDeferred<void>();

    (globalThis as any).__loaderTestEvents = loaderTestEvents;
    (globalThis as any).__loaderTestGate = loaderTestGate.promise;
    (globalThis as any).__loaderTestStartedA = loaderTestStartedA;

    await writeFile(
      c1,
      `globalThis.__loaderTestEvents.push("start-a");
      globalThis.__loaderTestStartedA.resolve();
      await globalThis.__loaderTestGate;
      globalThis.__loaderTestEvents.push("end-a");
      export default defineTool({ id: "a", description: "d", inputSchema: {}, run: () => {} });`
    );

    await writeFile(
      c2,
      `globalThis.__loaderTestEvents.push("start-b");
      export default defineTool({ id: "b", description: "d", inputSchema: {}, run: () => {} });`
    );

    const loadPromise = loadMirroredToolModules({
      lock,
      runtimeApi: activeToolRuntimeApi,
      candidates: [
        { sourcePath: "/src/a.ts", relativePath: "a.ts", modulePath: c1 },
        { sourcePath: "/src/b.ts", relativePath: "b.ts", modulePath: c2 },
      ],
    });

    await loaderTestStartedA.promise;
    await Promise.resolve();

    expect(loaderTestEvents).toEqual(["start-a"]);

    loaderTestGate.resolve();

    const results = await loadPromise;

    expect(loaderTestEvents).toEqual(["start-a", "end-a", "start-b"]);

    expect(results).toHaveLength(2);
    expect(results[0].definition.id).toBe("a");
    expect(results[1].definition.id).toBe("b");
  });

  it("should reject unbranded default exports", async () => {
    const lock = createToolRuntimeGlobalLock();
    const candidatePath = join(tempBaseDir, "fake.mjs");
    await writeFile(candidatePath, `export default { id: "fake", description: "d", inputSchema: {}, run: () => {} };`);

    await expect(
      loadMirroredToolModules({
        lock,
        runtimeApi: activeToolRuntimeApi,
        candidates: [{ sourcePath: "/src/fake.ts", relativePath: "fake.ts", modulePath: candidatePath }],
      })
    ).rejects.toThrowError(/does not have a valid default export created with defineTool/);
  });

  it("should reject syntax or resolution failures and wrap with the original sourcePath", async () => {
    const lock = createToolRuntimeGlobalLock();
    const candidatePath = join(tempBaseDir, "syntax-err.mjs");
    await writeFile(candidatePath, `export default defineTool({ id: "err"`); // syntax error

    const promise = loadMirroredToolModules({
      lock,
      runtimeApi: activeToolRuntimeApi,
      candidates: [{ sourcePath: "/src/syntax-err.ts", relativePath: "syntax-err.ts", modulePath: candidatePath }],
    });

    await expect(promise).rejects.toThrowError(/Failed to load tool definition from '\/src\/syntax-err\.ts'/);
    try {
      await promise;
    } catch (err: any) {
      expect(err.code).toBe(ErrorCode.TOOL_INVALID_DEFINITION);
      expect(err.cause).toBeDefined();
    }
  });

  it("should enforce runtime-to-static contract alignment", async () => {
    const lock = createToolRuntimeGlobalLock();

    const staticContract = {
      id: "my-tool",
      description: "original description",
      inputSchema: { type: "object", properties: { x: { type: "number" } } },
      outputSchema: { type: "string" },
      defaultTimeoutMs: 5000,
      metadata: { category: "math" },
    };

    // Test id drift
    const pathId = join(tempBaseDir, "tool-id.mjs");
    await writeFile(
      pathId,
      `export default defineTool({ id: "drift-id", description: "original description", inputSchema: { type: "object", properties: { x: { type: "number" } } }, outputSchema: { type: "string" }, defaultTimeoutMs: 5000, metadata: { category: "math" }, run: () => {} });`
    );
    await expect(
      loadMirroredToolModules({
        lock,
        runtimeApi: activeToolRuntimeApi,
        candidates: [
          {
            sourcePath: "/src/tool.ts",
            relativePath: "tool.ts",
            modulePath: pathId,
            staticContract,
          },
        ],
      })
    ).rejects.toThrowError(/Tool definition field 'id' changed/);

    // Test description drift
    const pathDesc = join(tempBaseDir, "tool-desc.mjs");
    await writeFile(
      pathDesc,
      `export default defineTool({ id: "my-tool", description: "drift desc", inputSchema: { type: "object", properties: { x: { type: "number" } } }, outputSchema: { type: "string" }, defaultTimeoutMs: 5000, metadata: { category: "math" }, run: () => {} });`
    );
    await expect(
      loadMirroredToolModules({
        lock,
        runtimeApi: activeToolRuntimeApi,
        candidates: [
          {
            sourcePath: "/src/tool.ts",
            relativePath: "tool.ts",
            modulePath: pathDesc,
            staticContract,
          },
        ],
      })
    ).rejects.toThrowError(/Tool definition field 'description' changed/);

    // Test inputSchema drift
    const pathInput = join(tempBaseDir, "tool-input.mjs");
    await writeFile(
      pathInput,
      `export default defineTool({ id: "my-tool", description: "original description", inputSchema: { type: "object" }, outputSchema: { type: "string" }, defaultTimeoutMs: 5000, metadata: { category: "math" }, run: () => {} });`
    );
    await expect(
      loadMirroredToolModules({
        lock,
        runtimeApi: activeToolRuntimeApi,
        candidates: [
          {
            sourcePath: "/src/tool.ts",
            relativePath: "tool.ts",
            modulePath: pathInput,
            staticContract,
          },
        ],
      })
    ).rejects.toThrowError(/Tool definition field 'inputSchema' changed/);

    // Test outputSchema drift
    const pathOutput = join(tempBaseDir, "tool-output.mjs");
    await writeFile(
      pathOutput,
      `export default defineTool({ id: "my-tool", description: "original description", inputSchema: { type: "object", properties: { x: { type: "number" } } }, outputSchema: { type: "object" }, defaultTimeoutMs: 5000, metadata: { category: "math" }, run: () => {} });`
    );
    await expect(
      loadMirroredToolModules({
        lock,
        runtimeApi: activeToolRuntimeApi,
        candidates: [
          {
            sourcePath: "/src/tool.ts",
            relativePath: "tool.ts",
            modulePath: pathOutput,
            staticContract,
          },
        ],
      })
    ).rejects.toThrowError(/Tool definition field 'outputSchema' changed/);

    // Test defaultTimeoutMs drift
    const pathTimeout = join(tempBaseDir, "tool-timeout.mjs");
    await writeFile(
      pathTimeout,
      `export default defineTool({ id: "my-tool", description: "original description", inputSchema: { type: "object", properties: { x: { type: "number" } } }, outputSchema: { type: "string" }, defaultTimeoutMs: 10000, metadata: { category: "math" }, run: () => {} });`
    );
    await expect(
      loadMirroredToolModules({
        lock,
        runtimeApi: activeToolRuntimeApi,
        candidates: [
          {
            sourcePath: "/src/tool.ts",
            relativePath: "tool.ts",
            modulePath: pathTimeout,
            staticContract,
          },
        ],
      })
    ).rejects.toThrowError(/Tool definition field 'defaultTimeoutMs' changed/);

    // Test metadata drift
    const pathMeta = join(tempBaseDir, "tool-meta.mjs");
    await writeFile(
      pathMeta,
      `export default defineTool({ id: "my-tool", description: "original description", inputSchema: { type: "object", properties: { x: { type: "number" } } }, outputSchema: { type: "string" }, defaultTimeoutMs: 5000, metadata: { category: "science" }, run: () => {} });`
    );
    await expect(
      loadMirroredToolModules({
        lock,
        runtimeApi: activeToolRuntimeApi,
        candidates: [
          {
            sourcePath: "/src/tool.ts",
            relativePath: "tool.ts",
            modulePath: pathMeta,
            staticContract,
          },
        ],
      })
    ).rejects.toThrowError(/Tool definition field 'metadata' changed/);
  });

  it("should restore globals and allow subsequent load session on the same lock after a failure", async () => {
    const lock = createToolRuntimeGlobalLock();
    const badCandidate = join(tempBaseDir, "bad.mjs");
    const goodCandidate = join(tempBaseDir, "good.mjs");

    await writeFile(badCandidate, `export default defineTool({ id: "bad"`); // syntax error
    await writeFile(goodCandidate, `export default defineTool({ id: "good", description: "d", inputSchema: {}, run: () => {} });`);

    // First attempt fails
    await expect(
      loadMirroredToolModules({
        lock,
        runtimeApi: activeToolRuntimeApi,
        candidates: [{ sourcePath: "/src/bad.ts", relativePath: "bad.ts", modulePath: badCandidate }],
      })
    ).rejects.toThrow();

    // Check globals restored
    expect(Object.prototype.hasOwnProperty.call(globalThis, "defineTool")).toBe(false);

    // Second attempt succeeds on the same lock
    const results = await loadMirroredToolModules({
      lock,
      runtimeApi: activeToolRuntimeApi,
      candidates: [{ sourcePath: "/src/good.ts", relativePath: "good.ts", modulePath: goodCandidate }],
    });

    expect(results).toHaveLength(1);
    expect(results[0].definition.id).toBe("good");
  });

  it("should reject collision before evaluation, preserve original descriptor, and not execute module code", async () => {
    const lock = createToolRuntimeGlobalLock();

    // Set a different value for globalThis.defineTool
    const foreignFunction = () => "foreign";
    Object.defineProperty(globalThis, "defineTool", {
      value: foreignFunction,
      enumerable: true,
      writable: true,
      configurable: true,
    });

    const markerFile = join(tempBaseDir, "evaluation.marker");
    const candidatePath = join(tempBaseDir, "collision-tool.mjs");
    await writeFile(
      candidatePath,
      `import * as fs from "node:fs";
fs.writeFileSync(${JSON.stringify(markerFile)}, "evaluated");
export default defineTool({ id: "collision", description: "d", inputSchema: {}, run: () => {} });`
    );

    await expect(
      loadMirroredToolModules({
        lock,
        runtimeApi: activeToolRuntimeApi,
        candidates: [{ sourcePath: "/src/collision-tool.ts", relativePath: "collision-tool.ts", modulePath: candidatePath }],
      })
    ).rejects.toThrowError(/Cannot install the active tool runtime: globalThis.defineTool is already bound/);

    // Verify module evaluation did not occur (marker file does not exist)
    expect(fs.existsSync(markerFile)).toBe(false);

    // Verify global descriptor is preserved
    const desc = Object.getOwnPropertyDescriptor(globalThis, "defineTool");
    expect(desc).toBeDefined();
    expect(desc?.value).toBe(foreignFunction);
    expect(desc?.enumerable).toBe(true);
    expect(desc?.writable).toBe(true);
    expect(desc?.configurable).toBe(true);
  });

  it("should not delete a replacement binding it no longer owns when callback/import replaces globalThis.defineTool", async () => {
    const lock = createToolRuntimeGlobalLock();
    const candidatePath = join(tempBaseDir, "replacement-tool.mjs");

    await writeFile(
      candidatePath,
      `Reflect.deleteProperty(globalThis, "defineTool");
      Object.defineProperty(globalThis, "defineTool", {
        value: () => "replaced-at-import-time",
        enumerable: true,
        writable: true,
        configurable: true
      });
      export default defineTool({ id: "replaced", description: "desc", inputSchema: {}, run: () => {} });`
    );

    const loadPromise = loadMirroredToolModules({
      lock,
      runtimeApi: activeToolRuntimeApi,
      candidates: [
        {
          sourcePath: "/original/path/replaced.ts",
          relativePath: "replaced.ts",
          modulePath: candidatePath,
        },
      ],
    });

    await expect(loadPromise).rejects.toThrow();
    const desc = Object.getOwnPropertyDescriptor(globalThis, "defineTool");
    expect(desc).toBeDefined();
    expect(typeof desc?.value).toBe("function");
    expect(desc?.value()).toBe("replaced-at-import-time");
    expect(desc?.enumerable).toBe(true);
  });
});
