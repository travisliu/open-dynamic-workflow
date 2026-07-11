import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { prepareToolRuntimePackageShim } from "../../../src/tools/runtime-package-shim.js";

describe("runtime-package-shim", () => {
  let tempBaseDir: string;
  let originalDescriptor: PropertyDescriptor | undefined;

  beforeEach(async () => {
    tempBaseDir = await mkdtemp(join(tmpdir(), "odw-shim-test-"));
    originalDescriptor = Object.getOwnPropertyDescriptor(globalThis, "defineTool");
  });

  afterEach(async () => {
    // Restore global descriptor
    if (originalDescriptor) {
      Object.defineProperty(globalThis, "defineTool", originalDescriptor);
    } else {
      // @ts-ignore
      delete globalThis.defineTool;
    }
    await rm(tempBaseDir, { recursive: true, force: true });
  });

  it("should create correct directory structure and package.json", async () => {
    const result = await prepareToolRuntimePackageShim({ tempDir: tempBaseDir });

    expect(result.packageDir).toBe(join(tempBaseDir, "node_modules", "@travisliu", "open-dynamic-workflow"));
    expect(result.packageJsonPath).toBe(join(result.packageDir, "package.json"));
    expect(result.modulePath).toBe(join(result.packageDir, "index.mjs"));

    // Check package.json contents
    const packageJsonContent = await readFile(result.packageJsonPath, "utf8");
    const manifest = JSON.parse(packageJsonContent);
    expect(manifest.name).toBe("@travisliu/open-dynamic-workflow");
    expect(manifest.private).toBe(true);
    expect(manifest.type).toBe("module");
    expect(manifest.exports).toEqual({ ".": "./index.mjs" });
  });

  it("should load the defined tool from globalThis when injected", async () => {
    const dummyDefineTool = () => {
      return "mocked-tool";
    };

    // Inject the dummy defineTool
    Object.defineProperty(globalThis, "defineTool", {
      value: dummyDefineTool,
      enumerable: false,
      writable: false,
      configurable: true,
    });

    const result = await prepareToolRuntimePackageShim({ tempDir: tempBaseDir });

    // Use unique query parameter to bypass Node ESM cache
    const importUrl = `${pathToFileURL(result.modulePath).href}?test=injected-${Date.now()}`;
    const imported = await import(importUrl);

    expect(imported.defineTool).toBe(dummyDefineTool);
  });

  it("should throw a clear error when globalThis.defineTool is not a function", async () => {
    // Make sure defineTool is not a function (or not present)
    if (Object.getOwnPropertyDescriptor(globalThis, "defineTool")) {
      // @ts-ignore
      delete globalThis.defineTool;
    }

    const result = await prepareToolRuntimePackageShim({ tempDir: tempBaseDir });

    // Use unique query parameter to bypass Node ESM cache
    const importUrl = `${pathToFileURL(result.modulePath).href}?test=not-a-func-${Date.now()}`;

    await expect(import(importUrl)).rejects.toThrow("The active ODW tool runtime is not available.");
  });

  it("should not import repository src, dist, or other files", async () => {
    const result = await prepareToolRuntimePackageShim({ tempDir: tempBaseDir });
    const content = await readFile(result.modulePath, "utf8");

    // Verify it doesn't contain reference to src, dist, or the main repo
    expect(content).not.toContain("src/");
    expect(content).not.toContain("dist/");
    expect(content).not.toContain("packages/");
    expect(content).not.toContain("define-tool");
  });
});
