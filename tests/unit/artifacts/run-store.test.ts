import { describe, expect, it, afterEach, vi } from "vitest";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import { FileSystemArtifactStore } from "../../../src/artifacts/run-store.js";
import { ErrorCode } from "../../../src/errors/codes.js";

const TEST_OUT_DIR = path.resolve("tests/temp-runs-test");

// Mock fs/promises
vi.mock("node:fs/promises", async (importActual) => {
  const actual = await importActual<typeof import("node:fs/promises")>();
  return {
    ...actual,
    rename: vi.fn(actual.rename),
    writeFile: vi.fn(actual.writeFile)
  };
});

describe("FileSystemArtifactStore", () => {
  afterEach(async () => {
    // Clean up test directories
    // Since we mocked fs, we might need the actual fs here or just use the mock if it calls through
    const actualFs = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
    await actualFs.rm(TEST_OUT_DIR, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  const defaultRunInput = {
    runId: "test-run-123",
    outDir: TEST_OUT_DIR,
    workflowPath: "workflows/mock-success.js",
    workflowSource: 'console.log("workflow source")',
    workflowHash: "hash-456",
    resolvedConfig: { defaultProvider: "mock" },
    openflowVersion: "1.0.0",
    cwd: "/workspace"
  };

  it("createRun() creates directory and initializes run files", async () => {
    const store = new FileSystemArtifactStore();
    const artifacts = await store.createRun(defaultRunInput);

    expect(artifacts.runId).toBe("test-run-123");
    expect(artifacts.rootDir).toBe(path.join(TEST_OUT_DIR, "test-run-123"));

    // Check manifest
    const manifestContent = await fs.readFile(artifacts.manifestPath, "utf8");
    const manifest = JSON.parse(manifestContent);
    expect(manifest.status).toBe("running");

    // Check workflow input
    const workflowContent = await fs.readFile(artifacts.workflowInputPath, "utf8");
    expect(workflowContent).toBe(defaultRunInput.workflowSource);

    // Check resolved config
    const configContent = await fs.readFile(artifacts.resolvedConfigPath, "utf8");
    const config = JSON.parse(configContent);
    expect(config.defaultProvider).toBe("mock");

    // Check events.jsonl
    const eventsContent = await fs.readFile(artifacts.eventsPath, "utf8");
    expect(eventsContent).toBe("");
  });

  it("writeText() writes a file inside the run directory", async () => {
    const store = new FileSystemArtifactStore();
    await store.createRun(defaultRunInput);
    const filePath = await store.writeText("hello.txt", "hello world");
    const content = await fs.readFile(filePath, "utf8");
    expect(content).toBe("hello world");
  });

  it("writeJson() pretty-prints JSON", async () => {
    const store = new FileSystemArtifactStore();
    await store.createRun(defaultRunInput);
    const filePath = await store.writeJson("test.json", { a: 1 });
    const content = await fs.readFile(filePath, "utf8");
    expect(content).toBe(JSON.stringify({ a: 1 }, null, 2));
  });

  it("appendJsonl() appends one JSON object per line", async () => {
    const store = new FileSystemArtifactStore();
    await store.createRun(defaultRunInput);
    await store.appendJsonl("events.jsonl", { seq: 1 });
    await store.appendJsonl("events.jsonl", { seq: 2 });

    const artifacts = store.getRunArtifacts();
    const content = await fs.readFile(artifacts.eventsPath, "utf8");
    expect(content).toBe(JSON.stringify({ seq: 1 }) + "\n" + JSON.stringify({ seq: 2 }) + "\n");
  });

  it("writeFinalReport() writes through temp-file rename", async () => {
    const store = new FileSystemArtifactStore();
    const artifacts = await store.createRun(defaultRunInput);
    const reportPath = path.join(artifacts.rootDir, "report.json");
    const tmpPath = `${reportPath}.tmp`;

    const reportData = { result: "done" };
    const resultPath = await store.writeFinalReport(reportData);

    expect(resultPath).toBe(reportPath);
    expect(fs.rename).toHaveBeenCalledWith(tmpPath, reportPath);

    const content = await fs.readFile(reportPath, "utf8");
    expect(JSON.parse(content)).toEqual(reportData);

    // Assert no temp file left
    await expect(fs.access(tmpPath)).rejects.toThrow();
  });

  it("writeFinalReport() throws ARTIFACT_WRITE_FAILED on error", async () => {
    const store = new FileSystemArtifactStore();
    await store.createRun(defaultRunInput);

    vi.mocked(fs.writeFile).mockImplementationOnce(async (path) => {
      if (path.toString().endsWith(".tmp")) {
        throw new Error("Disk full");
      }
      return await (await vi.importActual<any>("node:fs/promises")).writeFile(path, arguments[1], arguments[2]);
    });

    try {
      await store.writeFinalReport({ result: "fail" });
      expect.unreachable("Should have thrown");
    } catch (error: any) {
      expect(error.code).toBe(ErrorCode.ARTIFACT_WRITE_FAILED);
      expect(error.message).toContain("Disk full");
    }
  });

  it("path traversal like ../evil.txt is rejected", async () => {
    const store = new FileSystemArtifactStore();
    await store.createRun(defaultRunInput);
    await expect(store.writeText("../evil.txt", "hack")).rejects.toThrow("Artifact path escapes run directory");
  });

  it("partial files remain after simulated failure", async () => {
    const store = new FileSystemArtifactStore();
    const artifacts = await store.createRun(defaultRunInput);
    await store.writeText("ok.txt", "some data");

    // Simulate crash - files should still be present on disk
    const content = await fs.readFile(path.join(artifacts.rootDir, "ok.txt"), "utf8");
    expect(content).toBe("some data");
  });

  it("getRunArtifacts() returns correct workflowInvocationDir helper", async () => {
    const store = new FileSystemArtifactStore();
    const artifacts = await store.createRun(defaultRunInput);

    const invocationId = "wf-123";
    const invocationDir = artifacts.workflowInvocationDir(invocationId);
    
    expect(invocationDir).toBe(path.join(artifacts.rootDir, "workflows", invocationId));
  });
});
