import { describe, expect, it, beforeEach, afterEach } from "vitest";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import { DefaultAgentExecutor } from "../../../src/agents/execute-agent.js";
import { FileSystemArtifactStore } from "../../../src/artifacts/run-store.js";
import { EventBus } from "../../../src/orchestration/event-bus.js";
import { DefaultScheduler } from "../../../src/orchestration/scheduler.js";

const TEST_OUT_DIR = path.resolve("tests/temp-tc-06-unit");

describe("Timeout handling (Unit)", () => {
  beforeEach(async () => {
    await fs.mkdir(TEST_OUT_DIR, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(TEST_OUT_DIR, { recursive: true, force: true });
  });

  it("Timed-out process is terminated", async () => {
    const timeoutMs = 100;
    const config: any = {
      defaultProvider: "mock",
      providers: {
        mock: {
          responses: {
            "timeout-agent": {
              delayMs: 500, // Longer than timeout
              stdout: "some output",
              text: "should not be reached"
            }
          }
        }
      }
    };

    const store = new FileSystemArtifactStore({ rootDir: TEST_OUT_DIR });
    const runId = "test-run-tc-06-01-mock";
    const runOutDir = path.join(TEST_OUT_DIR, runId);
    
    await store.createRun({
      runId,
      outDir: runOutDir,
      workflowPath: "dummy.ts",
      workflowSource: "",
      workflowHash: "hash",
      resolvedConfig: config,
      openflowVersion: "1.0.0",
      cwd: process.cwd()
    });

    const eventBus = new EventBus({
      runId,
      artifactStore: store,
      subscribers: []
    });

    const executor = new DefaultAgentExecutor({
      config,
      artifactStore: store,
      eventBus
    });

    const scheduler = new DefaultScheduler({ concurrency: 1 });

    const result = await scheduler.schedule({
      id: "timeout-agent",
      provider: "mock",
      run: (signal) => executor.execute({
        id: "timeout-agent",
        label: "Timeout Agent",
        provider: "mock",
        prompt: "test prompt",
        timeoutMs: timeoutMs,
        cwd: process.cwd(),
        permissions: { mode: "default" },
        signal,
        metadata: {}
      })
    }, {
      timeoutMs: timeoutMs,
      provider: "mock"
    });

    // Assert
    expect(result.ok).toBe(false);
    expect(result.status).toBe("timed_out");
    expect(result.error.code).toBe("PROCESS_TIMEOUT");
    expect(result.exitCode).toBeNull();
    expect(result.durationMs).toBeGreaterThan(0);
    expect(result.durationMs).toBeLessThan(500); // Should have timed out before delay finished
  });
});
