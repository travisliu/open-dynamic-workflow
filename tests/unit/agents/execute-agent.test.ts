import { describe, expect, it, afterEach, beforeEach, vi } from "vitest";
import { OpenFlowError } from "../../../src/errors/types.js";
import { ErrorCode } from "../../../src/errors/codes.js";
import * as registryModule from "../../../src/agents/registry.js";
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

    const result = await executor.execute({
      id: "test-agent",
      label: "Test Agent",
      provider: "mock",
      prompt: "test prompt",
      model: "mock-model",
      timeoutMs: 5000,
      cwd: process.cwd(),
      permissions: { mode: "default" },
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

  it("reports status 'timed_out' when execution times out", async () => {
    const config: any = {
      defaultProvider: "mock",
      providers: {
        mock: {
          responses: {
            "timeout-agent": {
              timeout: true,
              stdout: "some output before timeout",
              stderr: ""
            }
          }
        }
      }
    };

    const store = new FileSystemArtifactStore({ rootDir: TEST_OUT_DIR });
    const runId = "test-run-timeout";
    const runOutDir = path.join(TEST_OUT_DIR, runId);
    await store.createRun({ runId, outDir: runOutDir, workflowPath: "dummy.ts", workflowSource: "", workflowHash: "hash", resolvedConfig: config, openflowVersion: "1.0.0", cwd: process.cwd() });
    const eventBus = new EventBus({ runId, artifactStore: store, subscribers: [] });
    const executor = new DefaultAgentExecutor({ config, artifactStore: store, eventBus });

    const result = await executor.execute({
      id: "timeout-agent",
      label: "Timeout Agent",
      provider: "mock",
      prompt: "test prompt",
      model: "mock-model",
      timeoutMs: 100,
      cwd: process.cwd(),
      permissions: { mode: "default" },
      signal: new AbortController().signal,
      metadata: {}
    });

    expect(result.ok).toBe(false);
    expect(result.status).toBe("timed_out");
    expect(result.stdout).toBe("some output before timeout");
  });

  it("reports status 'cancelled' when execution is cancelled", async () => {
    const config: any = {
      defaultProvider: "mock",
      providers: {
        mock: {
          responses: {
            "cancelled-agent": {
              fail: true,
              error: { code: "USER_CANCELLED" },
              stdout: "some output before cancellation",
              stderr: ""
            }
          }
        }
      }
    };

    const store = new FileSystemArtifactStore({ rootDir: TEST_OUT_DIR });
    const runId = "test-run-cancelled";
    const runOutDir = path.join(TEST_OUT_DIR, runId);
    await store.createRun({ runId, outDir: runOutDir, workflowPath: "dummy.ts", workflowSource: "", workflowHash: "hash", resolvedConfig: config, openflowVersion: "1.0.0", cwd: process.cwd() });
    const eventBus = new EventBus({ runId, artifactStore: store, subscribers: [] });
    const executor = new DefaultAgentExecutor({ config, artifactStore: store, eventBus });

    const result = await executor.execute({
      id: "cancelled-agent",
      label: "Cancelled Agent",
      provider: "mock",
      prompt: "test prompt",
      model: "mock-model",
      timeoutMs: 5000,
      cwd: process.cwd(),
      permissions: { mode: "default" },
      signal: new AbortController().signal,
      metadata: {}
    });

    expect(result.ok).toBe(false);
    expect(result.status).toBe("cancelled");
    expect(result.stdout).toBe("some output before cancellation");
  });

  it("follows precedence: timeout > cancellation > process failure", async () => {
    const config: any = {
      defaultProvider: "mock",
      providers: {
        mock: {
          responses: {
            "multi-fail-agent": {
              timeout: true,
              fail: true,
              error: { code: "USER_CANCELLED" },
              exitCode: 1,
              stdout: "mixed",
              stderr: "mixed"
            }
          }
        }
      }
    };

    const store = new FileSystemArtifactStore({ rootDir: TEST_OUT_DIR });
    const runId = "test-run-multi";
    const runOutDir = path.join(TEST_OUT_DIR, runId);
    await store.createRun({ runId, outDir: runOutDir, workflowPath: "dummy.ts", workflowSource: "", workflowHash: "hash", resolvedConfig: config, openflowVersion: "1.0.0", cwd: process.cwd() });
    const eventBus = new EventBus({ runId, artifactStore: store, subscribers: [] });
    const executor = new DefaultAgentExecutor({ config, artifactStore: store, eventBus });

    const result = await executor.execute({
      id: "multi-fail-agent",
      label: "Multi Fail Agent",
      provider: "mock",
      prompt: "test prompt",
      model: "mock-model",
      timeoutMs: 100,
      cwd: process.cwd(),
      permissions: { mode: "default" },
      signal: new AbortController().signal,
      metadata: {}
    });

    expect(result.ok).toBe(false);
    expect(result.status).toBe("timed_out"); // Timeout has highest precedence
  });

  it("writes durable logs for mock provider", async () => {
    const config: any = {
      defaultProvider: "mock",
      providers: {
        mock: {
          responses: {
            "log-agent": {
              stdout: "mock stdout",
              stderr: "mock stderr",
              text: "mock result",
              exitCode: 0
            }
          }
        }
      }
    };

    const store = new FileSystemArtifactStore({ rootDir: TEST_OUT_DIR });
    const runId = "test-run-logs";
    const runOutDir = path.join(TEST_OUT_DIR, runId);
    await store.createRun({ runId, outDir: runOutDir, workflowPath: "dummy.ts", workflowSource: "", workflowHash: "hash", resolvedConfig: config, openflowVersion: "1.0.0", cwd: process.cwd() });
    const eventBus = new EventBus({ runId, artifactStore: store, subscribers: [] });
    const executor = new DefaultAgentExecutor({ config, artifactStore: store, eventBus });

    await executor.execute({
      id: "log-agent",
      label: "Log Agent",
      provider: "mock",
      prompt: "test prompt",
      model: "mock-model",
      timeoutMs: 5000,
      cwd: process.cwd(),
      permissions: { mode: "default" },
      signal: new AbortController().signal,
      metadata: {}
    });

    const stdoutLog = await fs.readFile(path.join(runOutDir, "agents/log-agent/stdout.log"), "utf8");
    const stderrLog = await fs.readFile(path.join(runOutDir, "agents/log-agent/stderr.log"), "utf8");

    expect(stdoutLog).toBe("mock stdout");
    expect(stderrLog).toBe("mock stderr");
  });

  it("passes provider stdin to real process adapters", async () => {
    const config: any = {
      defaultProvider: "codex",
      providers: {
        mock: {
          responses: {}
        },
        codex: {
          command: "node",
          args: ["-e", "process.stdin.pipe(process.stdout)"],
          promptMode: "stdin",
          modelArg: false
        },
        gemini: {
          command: "node",
          args: ["-e", "process.exit(0)"]
        }
      },
      security: {
        allowWorkflowImports: false,
        passEnv: [],
        redactEnv: []
      }
    };

    const store = new FileSystemArtifactStore({ rootDir: TEST_OUT_DIR });
    const runId = "test-run-stdin-forwarding";
    const runOutDir = path.join(TEST_OUT_DIR, runId);
    await store.createRun({ runId, outDir: runOutDir, workflowPath: "dummy.ts", workflowSource: "", workflowHash: "hash", resolvedConfig: config, openflowVersion: "1.0.0", cwd: process.cwd() });
    const eventBus = new EventBus({ runId, artifactStore: store, subscribers: [] });
    const executor = new DefaultAgentExecutor({ config, artifactStore: store, eventBus });

    const prompt = "Review src/cli/index.ts for architectural alignment and code quality.";
    const result = await executor.execute({
      id: "stdin-agent",
      label: "Stdin Agent",
      provider: "codex",
      prompt,
      timeoutMs: 5000,
      cwd: process.cwd(),
      permissions: { mode: "default" },
      signal: new AbortController().signal,
      metadata: {}
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.text).toBe(prompt);
    }

    const stdoutLog = await fs.readFile(path.join(runOutDir, "agents/stdin-agent/stdout.log"), "utf8");
    expect(stdoutLog).toBe(prompt);
  });

  it("handles mock native structured output validation failure and writes raw-result.json", async () => {
    const config: any = {
      defaultProvider: "mock",
      providers: {
        mock: {
          responses: {}
        }
      }
    };

    const store = new FileSystemArtifactStore({ rootDir: TEST_OUT_DIR });
    const runId = "test-run-mock-native-fail";
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

    const eventBus = new EventBus({ runId, artifactStore: store, subscribers: [] });
    const executor = new DefaultAgentExecutor({ config, artifactStore: store, eventBus });

    const result = await executor.execute({
      id: "native-fail-agent",
      label: "Native Fail Agent",
      provider: "mock",
      prompt: "test prompt",
      model: "mock-model",
      schema: { type: "object" },
      structuredOutput: { transport: "native" },
      timeoutMs: 5000,
      cwd: process.cwd(),
      permissions: { mode: "default" },
      signal: new AbortController().signal,
      metadata: {}
    });

    // Verify execute result
    expect(result.ok).toBe(false);
    expect(result.status).toBe("failed");
    expect(result.error.code).toBe("CLI_USAGE_ERROR");
    expect(result.error.message).toContain("Mock provider does not support");
    expect(result.artifacts.dir).toBe("agents/native-fail-agent");
    expect(result.artifacts.rawResultPath).toBe("agents/native-fail-agent/raw-result.json");

    // Verify artifact files exist
    const agentDir = path.join(runOutDir, "agents/native-fail-agent");
    const promptTxt = await fs.readFile(path.join(agentDir, "prompt.txt"), "utf8");
    const metadataJson = JSON.parse(await fs.readFile(path.join(agentDir, "metadata.json"), "utf8"));
    const rawResultJson = JSON.parse(await fs.readFile(path.join(agentDir, "raw-result.json"), "utf8"));

    expect(promptTxt).toBe("test prompt");
    expect(metadataJson.model).toBe("mock-model");
    expect(rawResultJson.ok).toBe(false);
    expect(rawResultJson.error.code).toBe("CLI_USAGE_ERROR");
    expect(rawResultJson.error.message).toContain("Mock provider does not support");
  });

  it("handles buildCommand validation error and writes raw-result.json", async () => {
    const originalRegistry = registryModule.createDefaultProviderRegistry;
    const spy = vi.spyOn(registryModule, "createDefaultProviderRegistry").mockImplementation((deps) => {
      const registry = originalRegistry(deps);
      registry.register({
        name: "fake-validation-error-provider" as any,
        buildCommand: async () => {
          throw new OpenFlowError(ErrorCode.CLI_USAGE_ERROR, "Validation failed in buildCommand");
        },
        parseResult: async () => {
          return {};
        }
      });
      return registry;
    });

    const config: any = {
      defaultProvider: "fake-validation-error-provider",
      providers: {
        "fake-validation-error-provider": {
          command: "fake",
          args: []
        }
      }
    };

    const store = new FileSystemArtifactStore({ rootDir: TEST_OUT_DIR });
    const runId = "test-run-build-command-fail";
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

    const eventBus = new EventBus({ runId, artifactStore: store, subscribers: [] });
    const executor = new DefaultAgentExecutor({ config, artifactStore: store, eventBus });

    const result = await executor.execute({
      id: "fail-agent",
      label: "Fail Agent",
      provider: "fake-validation-error-provider" as any,
      prompt: "test prompt",
      model: "fake-model",
      timeoutMs: 5000,
      cwd: process.cwd(),
      permissions: { mode: "default" },
      signal: new AbortController().signal,
      metadata: {}
    });

    // Clean up spy
    spy.mockRestore();

    // Verify execute result
    expect(result.ok).toBe(false);
    expect(result.status).toBe("failed");
    expect(result.error.code).toBe("CLI_USAGE_ERROR");
    expect(result.error.message).toBe("Validation failed in buildCommand");
    expect(result.artifacts.dir).toBe("agents/fail-agent");
    expect(result.artifacts.rawResultPath).toBe("agents/fail-agent/raw-result.json");

    // Verify artifact files exist
    const agentDir = path.join(runOutDir, "agents/fail-agent");
    const promptTxt = await fs.readFile(path.join(agentDir, "prompt.txt"), "utf8");
    const metadataJson = JSON.parse(await fs.readFile(path.join(agentDir, "metadata.json"), "utf8"));
    const stdoutLog = await fs.readFile(path.join(agentDir, "stdout.log"), "utf8");
    const stderrLog = await fs.readFile(path.join(agentDir, "stderr.log"), "utf8");
    const rawResultJson = JSON.parse(await fs.readFile(path.join(agentDir, "raw-result.json"), "utf8"));

    expect(promptTxt).toBe("test prompt");
    expect(metadataJson.model).toBe("fake-model");
    expect(stdoutLog).toBe("");
    expect(stderrLog).toBe("");
    expect(rawResultJson.ok).toBe(false);
    expect(rawResultJson.error.code).toBe("CLI_USAGE_ERROR");
    expect(rawResultJson.error.message).toBe("Validation failed in buildCommand");
  });

  it("persists permissions metadata and creates permissions.json", async () => {
    const config: any = {
      defaultProvider: "mock",
      providers: {
        mock: {
          responses: {
            "perm-agent": { text: "perm success" }
          }
        }
      }
    };

    const store = new FileSystemArtifactStore({ rootDir: TEST_OUT_DIR });
    const runId = "test-run-perm";
    const runOutDir = path.join(TEST_OUT_DIR, runId);
    await store.createRun({ runId, outDir: runOutDir, workflowPath: "dummy.ts", workflowSource: "", workflowHash: "hash", resolvedConfig: config, openflowVersion: "1.0.0", cwd: process.cwd() });
    const eventBus = new EventBus({ runId, artifactStore: store, subscribers: [] });
    const executor = new DefaultAgentExecutor({ config, artifactStore: store, eventBus });

    const result = await executor.execute({
      id: "perm-agent",
      label: "Perm Agent",
      provider: "mock",
      prompt: "test prompt",
      model: "mock-model",
      timeoutMs: 5000,
      cwd: process.cwd(),
      signal: new AbortController().signal,
      metadata: {},
      permissions: { mode: "dangerously-full-access" }
    });

    expect(result.ok).toBe(true);
    expect(result.permissions).toEqual({ mode: "dangerously-full-access" });
    expect(result.artifacts.permissionsPath).toBe("agents/perm-agent/permissions.json");

    const agentDir = path.join(runOutDir, "agents/perm-agent");
    const permissionsJson = JSON.parse(await fs.readFile(path.join(agentDir, "permissions.json"), "utf8"));
    expect(permissionsJson).toEqual({ mode: "dangerously-full-access" });

    const metadataJson = JSON.parse(await fs.readFile(path.join(agentDir, "metadata.json"), "utf8"));
    expect(metadataJson.permissions).toEqual({ mode: "dangerously-full-access" });
  });

  it("merges permissions directly into raw result if it is a non-array object", async () => {
    const spy = vi.spyOn(registryModule, "createDefaultProviderRegistry").mockImplementation((deps) => {
      const registry = new registryModule.ProviderRegistry();
      registry.register({
        name: "mock",
        lookupResponse: () => ({
          stdout: "success",
          exitCode: 0
        }),
        buildCommand: async () => ({ command: "mock", args: [] }),
        parseResult: async () => {
          return {
            text: "success",
            raw: { foo: "bar" }
          };
        }
      });
      return registry;
    });

    const config: any = {
      defaultProvider: "mock",
      providers: {
        mock: {
          responses: {}
        }
      }
    };

    const store = new FileSystemArtifactStore({ rootDir: TEST_OUT_DIR });
    const runId = "test-run-object-raw";
    const runOutDir = path.join(TEST_OUT_DIR, runId);
    await store.createRun({ runId, outDir: runOutDir, workflowPath: "dummy.ts", workflowSource: "", workflowHash: "hash", resolvedConfig: config, openflowVersion: "1.0.0", cwd: process.cwd() });
    const eventBus = new EventBus({ runId, artifactStore: store, subscribers: [] });
    const executor = new DefaultAgentExecutor({ config, artifactStore: store, eventBus });

    const result = await executor.execute({
      id: "object-raw-agent",
      label: "Object Raw Agent",
      provider: "mock",
      prompt: "test prompt",
      model: "mock-model",
      timeoutMs: 5000,
      cwd: process.cwd(),
      permissions: { mode: "dangerously-full-access" },
      signal: new AbortController().signal,
      metadata: {}
    });

    spy.mockRestore();

    expect(result.ok).toBe(true);
    const agentDir = path.join(runOutDir, "agents/object-raw-agent");
    const rawResultJson = JSON.parse(await fs.readFile(path.join(agentDir, "raw-result.json"), "utf8"));
    expect(rawResultJson).toEqual({
      foo: "bar",
      permissions: { mode: "dangerously-full-access" },
      metadata: {}
    });
  });

  it("wraps raw result in an envelope if it is a primitive string or array", async () => {
    const spy = vi.spyOn(registryModule, "createDefaultProviderRegistry").mockImplementation((deps) => {
      const registry = new registryModule.ProviderRegistry();
      registry.register({
        name: "mock",
        lookupResponse: () => ({
          stdout: "success",
          exitCode: 0
        }),
        buildCommand: async () => ({ command: "mock", args: [] }),
        parseResult: async () => {
          return {
            text: "success",
            raw: "primitive string"
          };
        }
      });
      return registry;
    });

    const config: any = {
      defaultProvider: "mock",
      providers: {
        mock: {
          responses: {}
        }
      }
    };

    const store = new FileSystemArtifactStore({ rootDir: TEST_OUT_DIR });
    const runId = "test-run-primitive-raw";
    const runOutDir = path.join(TEST_OUT_DIR, runId);
    await store.createRun({ runId, outDir: runOutDir, workflowPath: "dummy.ts", workflowSource: "", workflowHash: "hash", resolvedConfig: config, openflowVersion: "1.0.0", cwd: process.cwd() });
    const eventBus = new EventBus({ runId, artifactStore: store, subscribers: [] });
    const executor = new DefaultAgentExecutor({ config, artifactStore: store, eventBus });

    const result = await executor.execute({
      id: "primitive-raw-agent",
      label: "Primitive Raw Agent",
      provider: "mock",
      prompt: "test prompt",
      model: "mock-model",
      timeoutMs: 5000,
      cwd: process.cwd(),
      permissions: { mode: "dangerously-full-access" },
      signal: new AbortController().signal,
      metadata: {}
    });

    spy.mockRestore();

    expect(result.ok).toBe(true);
    const agentDir = path.join(runOutDir, "agents/primitive-raw-agent");
    const rawResultJson = JSON.parse(await fs.readFile(path.join(agentDir, "raw-result.json"), "utf8"));
    expect(rawResultJson).toEqual({
      raw: "primitive string",
      permissions: { mode: "dangerously-full-access" },
      metadata: {}
    });
  });

  it("wraps raw result in an envelope if it is a primitive array", async () => {
    const spy = vi.spyOn(registryModule, "createDefaultProviderRegistry").mockImplementation((deps) => {
      const registry = new registryModule.ProviderRegistry();
      registry.register({
        name: "mock",
        lookupResponse: () => ({
          stdout: "success",
          exitCode: 0
        }),
        buildCommand: async () => ({ command: "mock", args: [] }),
        parseResult: async () => {
          return {
            text: "success",
            raw: ["item1", "item2"]
          };
        }
      });
      return registry;
    });

    const config: any = {
      defaultProvider: "mock",
      providers: {
        mock: {
          responses: {}
        }
      }
    };

    const store = new FileSystemArtifactStore({ rootDir: TEST_OUT_DIR });
    const runId = "test-run-array-raw";
    const runOutDir = path.join(TEST_OUT_DIR, runId);
    await store.createRun({ runId, outDir: runOutDir, workflowPath: "dummy.ts", workflowSource: "", workflowHash: "hash", resolvedConfig: config, openflowVersion: "1.0.0", cwd: process.cwd() });
    const eventBus = new EventBus({ runId, artifactStore: store, subscribers: [] });
    const executor = new DefaultAgentExecutor({ config, artifactStore: store, eventBus });

    const result = await executor.execute({
      id: "array-raw-agent",
      label: "Array Raw Agent",
      provider: "mock",
      prompt: "test prompt",
      model: "mock-model",
      timeoutMs: 5000,
      cwd: process.cwd(),
      permissions: { mode: "dangerously-full-access" },
      signal: new AbortController().signal,
      metadata: {}
    });

    spy.mockRestore();

    expect(result.ok).toBe(true);
    const agentDir = path.join(runOutDir, "agents/array-raw-agent");
    const rawResultJson = JSON.parse(await fs.readFile(path.join(agentDir, "raw-result.json"), "utf8"));
    expect(rawResultJson).toEqual({
      raw: ["item1", "item2"],
      permissions: { mode: "dangerously-full-access" },
      metadata: {}
    });
  });

  it("sanitizes and size-limits metadata in artifacts and results", async () => {
    const config: any = {
      defaultProvider: "mock",
      providers: {
        mock: {
          responses: {
            "metadata-agent": { text: "success" }
          }
        }
      }
    };

    const store = new FileSystemArtifactStore({ rootDir: TEST_OUT_DIR });
    const runId = "test-run-metadata-sanitization";
    const runOutDir = path.join(TEST_OUT_DIR, runId);
    await store.createRun({ runId, outDir: runOutDir, workflowPath: "dummy.ts", workflowSource: "", workflowHash: "hash", resolvedConfig: config, openflowVersion: "1.0.0", cwd: process.cwd() });
    const eventBus = new EventBus({ runId, artifactStore: store, subscribers: [] });
    const executor = new DefaultAgentExecutor({ config, artifactStore: store, eventBus });

    const longString = "a".repeat(300);
    const result = await executor.execute({
      id: "metadata-agent",
      label: "Metadata Agent",
      provider: "mock",
      prompt: "test prompt",
      model: "mock-model",
      timeoutMs: 5000,
      cwd: process.cwd(),
      permissions: { mode: "default" },
      signal: new AbortController().signal,
      metadata: {
        sharedAgentId: longString,
        secret: "should-be-redacted",
        pipelineId: "pipe-1"
      }
    });

    expect(result.ok).toBe(true);
    // Verify result metadata
    expect((result as any).metadata.sharedAgentId).toHaveLength(256 + 3);
    expect((result as any).metadata.pipelineId).toBe("pipe-1");
    expect((result as any).metadata).not.toHaveProperty("secret");

    // Verify metadata.json artifact
    const agentDir = path.join(runOutDir, "agents/metadata-agent");
    const metadataJson = JSON.parse(await fs.readFile(path.join(agentDir, "metadata.json"), "utf8"));
    expect(metadataJson.sharedAgentId).toHaveLength(256 + 3);
    expect(metadataJson.pipelineId).toBe("pipe-1");
    expect(metadataJson).not.toHaveProperty("secret");
    expect(metadataJson.model).toBe("mock-model"); // model is added by executor after sanitization
  });
});
