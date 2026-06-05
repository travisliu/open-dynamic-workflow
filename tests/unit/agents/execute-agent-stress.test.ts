import { describe, expect, it, beforeEach, afterEach } from "vitest";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import { DefaultAgentExecutor } from "../../../src/agents/execute-agent.js";
import { FileSystemArtifactStore } from "../../../src/artifacts/run-store.js";
import { EventBus } from "../../../src/orchestration/event-bus.js";

const TEST_OUT_DIR = path.resolve("tests/temp-execute-agent-stress");

describe("DefaultAgentExecutor stress and edge cases", () => {
  beforeEach(async () => {
    await fs.mkdir(TEST_OUT_DIR, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(TEST_OUT_DIR, { recursive: true, force: true });
  });

  it("VULNERABILITY REPRODUCTION: redacts secrets even when split across chunks", async () => {
    const secret = "SUPER-SECRET-123456";
    process.env.TEST_SECRET_KEY = secret;

    const config: any = {
      defaultProvider: "codex",
      providers: {
        codex: {
          // A command that outputs the secret in two parts
          command: "node",
          args: ["-e", `
            process.stdout.write("The secret is: SUPER-SECRET-");
            setTimeout(() => {
              process.stdout.write("123456\\n");
            }, 10);
          `]
        }
      },
      security: {
        passEnv: [],
        redactEnv: ["TEST_SECRET_KEY"]
      }
    };

    const store = new FileSystemArtifactStore({ rootDir: TEST_OUT_DIR });
    const runId = "test-run-split-secret";
    await store.createRun({
      runId,
      outDir: path.join(TEST_OUT_DIR, runId),
      workflowPath: "dummy.ts",
      workflowSource: "",
      workflowHash: "hash",
      resolvedConfig: config,
      openflowVersion: "1.0.0",
      cwd: process.cwd()
    });

    const eventBus = new EventBus({ runId, artifactStore: store, subscribers: [] });
    const executor = new DefaultAgentExecutor({ config, artifactStore: store, eventBus });

    const result = await executor.execute({
      id: "split-secret-agent",
      label: "Split Secret Agent",
      provider: "codex",
      prompt: "test",
      timeoutMs: 5000,
      cwd: process.cwd(),
      signal: new AbortController().signal,
      metadata: {}
    });

    delete process.env.TEST_SECRET_KEY;

    expect(result.ok).toBe(true);
    // If this fails, the vulnerability is confirmed
    expect(result.stdout).not.toContain(secret);
    expect(result.stdout).toContain("[REDACTED]");
  });

  it("handles large output without excessive memory usage in results", async () => {
    const config: any = {
      defaultProvider: "codex",
      providers: {
        codex: {
          command: "node",
          args: ["-e", `
            // Output 2MB of data
            const chunk = "A".repeat(1024);
            for (let i = 0; i < 2048; i++) {
              process.stdout.write(chunk);
            }
          `]
        }
      }
    };

    const store = new FileSystemArtifactStore({ rootDir: TEST_OUT_DIR });
    const runId = "test-run-large-output";
    await store.createRun({
      runId,
      outDir: path.join(TEST_OUT_DIR, runId),
      workflowPath: "dummy.ts",
      workflowSource: "",
      workflowHash: "hash",
      resolvedConfig: config,
      openflowVersion: "1.0.0",
      cwd: process.cwd()
    });

    const eventBus = new EventBus({ runId, artifactStore: store, subscribers: [] });
    const executor = new DefaultAgentExecutor({ config, artifactStore: store, eventBus });

    const result = await executor.execute({
      id: "large-output-agent",
      label: "Large Output Agent",
      provider: "codex",
      prompt: "test",
      timeoutMs: 10000,
      cwd: process.cwd(),
      signal: new AbortController().signal,
      metadata: {}
    });

    expect(result.ok).toBe(true);
    // In-memory stdout should be capped at roughly MAX_IN_MEMORY_LOG_SIZE (1MB)
    // We allow some extra buffer (64KB) since the check happens before appending chunks.
    expect(result.stdout.length).toBeLessThanOrEqual(1024 * 1024 + 65536); 
    expect(result.stdout.length).toBeGreaterThan(1024 * 512);

    // Verify disk logs are full size
    const stdoutLog = await fs.readFile(path.join(TEST_OUT_DIR, runId, "agents/large-output-agent/stdout.log"), "utf8");
    expect(stdoutLog.length).toBe(2048 * 1024);
  });

  it("handles I/O failures gracefully", async () => {
    const config: any = {
      defaultProvider: "mock",
      providers: {
        mock: {
          responses: { "io-fail": { text: "success" } }
        }
      }
    };

    const store = new FileSystemArtifactStore({ rootDir: TEST_OUT_DIR });
    const runId = "test-run-io-fail";
    await store.createRun({ runId, outDir: path.join(TEST_OUT_DIR, runId), workflowPath: "dummy.ts", workflowSource: "", workflowHash: "hash", resolvedConfig: config, openflowVersion: "1.0.0", cwd: process.cwd() });
    
    // Mock appendText to fail
    (store as any).appendText = async () => {
      throw new Error("Disk full");
    };

    const eventBus = new EventBus({ runId, artifactStore: store, subscribers: [] });
    const executor = new DefaultAgentExecutor({ config, artifactStore: store, eventBus });

    // This should NOT crash the executor, but might result in failure if we decide so.
    // Currently DefaultAgentExecutor awaits appendText.
    
    await expect(executor.execute({
      id: "io-fail",
      label: "IO Fail",
      provider: "mock",
      prompt: "test",
      timeoutMs: 5000,
      cwd: process.cwd(),
      signal: new AbortController().signal,
      metadata: {}
    })).rejects.toThrow("Disk full");
  });
});
