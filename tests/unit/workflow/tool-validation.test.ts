import { describe, it, expect, beforeEach } from "vitest";
import { createDsl } from "../../../src/workflow/dsl.js";
import { withDslExecutionScope } from "../../../src/workflow/scope.js";
import { InvalidDslCallError } from "../../../src/workflow/errors.js";

describe("Workflow Tool Input Validation", () => {
  let mockRuntime: any;

  beforeEach(() => {
    mockRuntime = {
      runId: "test-run",
      config: { timeoutMs: 30000 },
      abortController: new AbortController(),
      toolCallIds: new Set(["duplicate-id"]),
      toolCounter: 0,
      toolRegistry: {
        require: () => ({
          definition: { id: "test-tool", defaultTimeoutMs: 1000, run: () => ({}) },
          validateInput: () => ({ ok: true, value: {} }),
          validateOutput: () => ({ ok: true, value: {} })
        })
      },
      toolExecutor: {
        execute: async () => ({ ok: true, output: {}, durationMs: 1 }),
        getSummaries: () => []
      }
    };
  });

  const runWithScope = (fn: () => any) => {
    const scope = {
      runId: "test-run",
      workflowInvocationId: "root",
      location: "workflow-top-level" as const,
      toolAllowed: true,
      topLevelWindow: true
    };
    return withDslExecutionScope(scope, fn);
  };

  it("should reject non-object input", async () => {
    const dsl = createDsl(mockRuntime);
    await expect(runWithScope(() => dsl.tool(null as any))).rejects.toThrow(InvalidDslCallError);
    await expect(runWithScope(() => dsl.tool([] as any))).rejects.toThrow(InvalidDslCallError);
    await expect(runWithScope(() => dsl.tool("string" as any))).rejects.toThrow(InvalidDslCallError);
  });

  it("should reject unknown top-level keys", async () => {
    const dsl = createDsl(mockRuntime);
    await expect(runWithScope(() => dsl.tool({ definition: "test-tool", args: {}, unknownKey: 123 } as any))).rejects.toThrow(
      /unknown keys: unknownKey/
    );
  });

  it("should reject missing definition or empty definition", async () => {
    const dsl = createDsl(mockRuntime);
    await expect(runWithScope(() => dsl.tool({ args: {} } as any))).rejects.toThrow(/definition/);
    await expect(runWithScope(() => dsl.tool({ definition: "", args: {} } as any))).rejects.toThrow(/definition/);
  });

  it("should reject missing args", async () => {
    const dsl = createDsl(mockRuntime);
    await expect(runWithScope(() => dsl.tool({ definition: "test-tool" } as any))).rejects.toThrow(/args/);
  });

  it("should reject invalid failureMode", async () => {
    const dsl = createDsl(mockRuntime);
    await expect(runWithScope(() => dsl.tool({ definition: "test-tool", args: {}, failureMode: "invalid" as any }))).rejects.toThrow(
      /failureMode/
    );
  });

  it("should reject invalid timeoutMs", async () => {
    const dsl = createDsl(mockRuntime);
    await expect(runWithScope(() => dsl.tool({ definition: "test-tool", args: {}, timeoutMs: -5 }))).rejects.toThrow(/timeoutMs/);
    await expect(runWithScope(() => dsl.tool({ definition: "test-tool", args: {}, timeoutMs: 1.5 }))).rejects.toThrow(/timeoutMs/);
  });

  it("should reject unsafe explicit IDs", async () => {
    const dsl = createDsl(mockRuntime);
    await expect(runWithScope(() => dsl.tool({ definition: "test-tool", args: {}, id: "unsafe/id" }))).rejects.toThrow(/unsafe/);
    await expect(runWithScope(() => dsl.tool({ definition: "test-tool", args: {}, id: "unsafe space" }))).rejects.toThrow(/unsafe/);
  });

  it("should reject duplicate explicit IDs", async () => {
    const dsl = createDsl(mockRuntime);
    await expect(runWithScope(() => dsl.tool({ definition: "test-tool", args: {}, id: "duplicate-id" }))).rejects.toThrow(/already used/);
  });

  it("should reject non-plain-object metadata", async () => {
    const dsl = createDsl(mockRuntime);
    class CustomMetadata {}
    await expect(runWithScope(() => dsl.tool({ definition: "test-tool", args: {}, metadata: new CustomMetadata() as any }))).rejects.toThrow(
      /metadata/
    );
    await expect(runWithScope(() => dsl.tool({ definition: "test-tool", args: {}, metadata: [] as any }))).rejects.toThrow(/metadata/);
  });

  it("should reject non-serializable metadata values", async () => {
    const dsl = createDsl(mockRuntime);
    await expect(runWithScope(() => dsl.tool({ definition: "test-tool", args: {}, metadata: { func: () => {} } }))).rejects.toThrow(
      /metadata/
    );
    await expect(runWithScope(() => dsl.tool({ definition: "test-tool", args: {}, metadata: { big: 123n } as any }))).rejects.toThrow(
      /metadata/
    );
  });
});
