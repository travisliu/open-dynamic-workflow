import { describe, expect, it, afterEach, beforeEach } from "vitest";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import { DefaultAgentExecutor } from "../../../src/agents/execute-agent.js";
import { FileSystemArtifactStore } from "../../../src/artifacts/run-store.js";
import { EventBus } from "../../../src/orchestration/event-bus.js";

const TEST_OUT_DIR = path.resolve("tests/temp-execute-agent-test");

describe("DefaultAgentExecutor environment and redaction", () => {
  beforeEach(async () => {
    await fs.mkdir(TEST_OUT_DIR, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(TEST_OUT_DIR, { recursive: true, force: true });
  });

  it("filters environment variables and redacts secrets", async () => {
    // Setup process environment with a secret
    process.env.SECRET_KEY_FOR_TEST = "super-secret-value-123456";
    process.env.PASSED_VAR_FOR_TEST = "passed-value-789";

    const config: any = {
      defaultProvider: "mock",
      concurrency: 1,
      timeoutMs: 5000,
      providers: {
        mock: {
          command: "mock",
          args: [],
          responses: {
            "test-agent": {
              stdout: "Secret key leaked: super-secret-value-123456",
              stderr: "Another leak: super-secret-value-123456",
              text: "Secret key leaked: super-secret-value-123456",
              exitCode: 0
            }
          }
        }
      },
      security: {
        allowShell: false,
        allowWorkflowImports: false,
        passEnv: ["PASSED_VAR_FOR_TEST"],
        redactEnv: ["*_KEY_FOR_TEST"]
      }
    };

    const store = new FileSystemArtifactStore({ rootDir: TEST_OUT_DIR });
    const runId = "test-run-exec-agent";
    const runOutDir = path.join(TEST_OUT_DIR, runId);
    
    await store.createRun({
      runId,
      outDir: runOutDir,
      workflowPath: "dummy.ts",
      workflowSource: "",
      workflowHash: "hash",
      resolvedConfig: config,
      execflowVersion: "1.0.0",
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

    const result = await executor.execute({
      id: "test-agent",
      label: "Test Agent",
      provider: "mock",
      prompt: "test prompt",
      model: "mock-model",
      timeoutMs: 5000,
      cwd: process.cwd(),
      signal: new AbortController().signal,
      metadata: {}
    });

    expect(result.ok).toBe(true);
    expect(result.stdout).not.toContain("super-secret-value-123456");
    expect(result.stdout).toContain("Secret key leaked: [REDACTED]");
    expect(result.stderr).not.toContain("super-secret-value-123456");
    expect(result.stderr).toContain("Another leak: [REDACTED]");

    if (result.ok) {
      expect(result.text).toContain("[REDACTED]");
      expect(result.text).not.toContain("super-secret-value-123456");
    }

    // Clean up
    delete process.env.SECRET_KEY_FOR_TEST;
    delete process.env.PASSED_VAR_FOR_TEST;
  });
});
