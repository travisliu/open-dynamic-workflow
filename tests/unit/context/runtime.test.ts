import { describe, expect, it } from "vitest";
import vm from "node:vm";
import { createWorkflowContextRuntime } from "../../../src/context/runtime.js";
import { ErrorCode } from "../../../src/errors/codes.js";
import { contextSet, contextMerge, contextAppend } from "../../../src/context/operations.js";

function createRuntimeAndContext() {
  // Arrange
  const runtime = createWorkflowContextRuntime({ runId: "test-run" });
  const ctx = runtime.createFacade();
  return { runtime, ctx };
}

describe("Workflow Context Runtime", () => {
  it("supports basic set, get, has, and delete operations", () => {
    // Arrange
    const { ctx } = createRuntimeAndContext();

    // Act / Assert
    expect(ctx.has("foo")).toBe(false);
    expect(ctx.get("foo")).toBeUndefined();

    // Act
    ctx.set("foo", { bar: "baz", val: null });

    // Assert
    expect(ctx.has("foo")).toBe(true);
    expect(ctx.has("foo.bar")).toBe(true);
    expect(ctx.has("foo.val")).toBe(true);
    expect(ctx.get("foo.bar")).toBe("baz");
    expect(ctx.get("foo.val")).toBeNull();

    // Act
    expect(ctx.delete("foo.bar")).toBe(true);

    // Assert
    expect(ctx.has("foo.bar")).toBe(false);
    expect(ctx.get("foo")).toEqual({ val: null });

    expect(ctx.delete("foo.bar")).toBe(false);
  });

  it("returns deep copies from get and snapshot", () => {
    // Arrange
    const { ctx } = createRuntimeAndContext();
    const original = { list: [1, 2], nested: { label: "ok" } };

    // Act
    ctx.set("data", original);
    const retrieved: any = ctx.get("data");

    // Assert
    expect(retrieved).toEqual(original);
    expect(retrieved).not.toBe(original);
    expect(retrieved.nested).not.toBe(original.nested);

    // Act
    retrieved.list.push(3);

    // Assert
    expect(ctx.get("data.list")).toEqual([1, 2]);

    // Act
    const snap = ctx.snapshot();

    // Assert
    expect(snap.data).toEqual(original);
    expect(snap.data).not.toBe(original);

    // Act
    (snap.data as any).nested.label = "changed";

    // Assert
    expect(ctx.get("data.nested.label")).toBe("ok");
  });

  it("fails validation and size checks before mutating the previous value", () => {
    // Arrange
    const { ctx } = createRuntimeAndContext();

    // Act
    ctx.set("config.val", "initial");

    // Act / Assert
    expect(() => ctx.set("config.val", undefined)).toThrow(
      expect.objectContaining({
        code: ErrorCode.CONTEXT_INVALID_VALUE,
      })
    );
    expect(ctx.get("config.val")).toBe("initial");

    // Act / Assert
    const largeStr = "x".repeat(300 * 1024);
    expect(() => ctx.set("config.val", largeStr)).toThrow(
      expect.objectContaining({
        code: ErrorCode.CONTEXT_SIZE_LIMIT_EXCEEDED,
      })
    );
    expect(ctx.get("config.val")).toBe("initial");

    // Act
    ctx.set("merge.target", { value: "keep" });

    // Act / Assert
    expect(() => ctx.merge("merge.target", undefined as any)).toThrow(
      expect.objectContaining({
        code: ErrorCode.CONTEXT_INVALID_VALUE,
      })
    );
    expect(ctx.get("merge.target")).toEqual({ value: "keep" });

    // Act
    ctx.set("append.target", []);

    // Act / Assert
    expect(() =>
      ctx.merge("merge.target", {
        large: "x".repeat(300 * 1024),
      } as any)
    ).toThrow(
      expect.objectContaining({
        code: ErrorCode.CONTEXT_SIZE_LIMIT_EXCEEDED,
      })
    );
    expect(ctx.get("merge.target")).toEqual({ value: "keep" });

    // Act / Assert
    expect(() => ctx.append("append.target", "x".repeat(300 * 1024))).toThrow(
      expect.objectContaining({
        code: ErrorCode.CONTEXT_SIZE_LIMIT_EXCEEDED,
      })
    );
    expect(ctx.get("append.target")).toEqual([]);
  });

  it("fails when traversing through arrays before the terminal segment", () => {
    // Arrange
    const { ctx } = createRuntimeAndContext();

    // Act
    ctx.set("list", [1, 2, 3]);

    // Act / Assert
    expect(() => ctx.get("list.sub.item")).toThrow(
      expect.objectContaining({
        code: ErrorCode.CONTEXT_TYPE_MISMATCH,
      })
    );

    expect(() => ctx.set("list.sub.item", 4)).toThrow(
      expect.objectContaining({
        code: ErrorCode.CONTEXT_TYPE_MISMATCH,
      })
    );
  });

  it("supports shallow merge and append semantics", () => {
    // Arrange
    const { ctx } = createRuntimeAndContext();

    // Act
    ctx.set("obj", { a: 1, b: 2 });
    ctx.merge("obj", { b: 3, c: 4 });

    // Assert
    expect(ctx.get("obj")).toEqual({ a: 1, b: 3, c: 4 });

    // Act
    ctx.merge("merge.missing", { x: 10 });

    // Assert
    expect(ctx.get("merge.missing")).toEqual({ x: 10 });

    // Act / Assert
    expect(() => ctx.merge("obj", [] as any)).toThrow(
      expect.objectContaining({
        code: ErrorCode.CONTEXT_TYPE_MISMATCH,
      })
    );
    expect(() => ctx.merge("obj", "string" as any)).toThrow(
      expect.objectContaining({
        code: ErrorCode.CONTEXT_TYPE_MISMATCH,
      })
    );

    // Act
    ctx.set("prim", 42);

    // Act / Assert
    expect(() => ctx.merge("prim", { x: 1 })).toThrow(
      expect.objectContaining({
        code: ErrorCode.CONTEXT_TYPE_MISMATCH,
      })
    );

    // Act
    ctx.set("arr", [1, 2]);
    ctx.append("arr", 3);

    // Assert
    expect(ctx.get("arr")).toEqual([1, 2, 3]);

    // Act
    ctx.append("append.missing", "first");

    // Assert
    expect(ctx.get("append.missing")).toEqual(["first"]);

    // Act
    ctx.set("prim", 42);

    // Act / Assert
    expect(() => ctx.append("prim", 43)).toThrow(
      expect.objectContaining({
        code: ErrorCode.CONTEXT_TYPE_MISMATCH,
      })
    );
  });

  it("prefixes scoped operations and restores the prefix after failures", async () => {
    // Arrange
    const { ctx } = createRuntimeAndContext();

    // Act
    ctx.set("globalVal", 1);

    await ctx.scope("nested", async () => {
      ctx.set("val", 2);

      // Assert
      expect(ctx.get("val")).toBe(2);
      expect(ctx.get("nested.val")).toBe(2);

      await ctx.scope("deep", () => {
        ctx.set("val", 3);

        // Assert
        expect(ctx.get("val")).toBe(3);
        expect(ctx.get("nested.deep.val")).toBe(3);
      });

      // Assert
      expect(ctx.get("val")).toBe(2);
    });

    // Assert
    expect(ctx.get("globalVal")).toBe(1);
    expect(ctx.get("nested.val")).toBe(2);
    expect(ctx.get("nested.deep.val")).toBe(3);

    try {
      await ctx.scope("fail", () => {
        throw new Error("sync failure");
      });
    } catch {}

    // Act
    ctx.set("after", "ok");

    // Assert
    expect(ctx.get("after")).toBe("ok");
    expect(ctx.get("fail.after")).toBeUndefined();

    try {
      await ctx.scope("async-fail", async () => {
        throw new Error("async failure");
      });
    } catch {}

    // Act
    ctx.set("after-async", "ok");

    // Assert
    expect(ctx.get("after-async")).toBe("ok");
    expect(ctx.get("async-fail.after-async")).toBeUndefined();
  });

  it("returns a root metadata snapshot with visible copy semantics", () => {
    // Arrange
    const runtime = createWorkflowContextRuntime({ runId: "test-run-123" });
    const ctx = runtime.createFacade();

    // Act
    ctx.set("a", 1);
    const snap = ctx.snapshot({ metadata: true });

    // Assert
    expect(snap.values).toEqual({ a: 1 });
    expect(snap.metadata).toEqual({
      scopeId: "test-run-123",
      visibleScopes: ["test-run-123"],
      sourcePaths: {
        a: "test-run-123",
      },
      deletedPaths: [],
      serializedBytes: expect.any(Number),
      limitBytes: expect.any(Number),
    });

    // Act
    snap.values.a = 2;

    // Assert
    expect(ctx.get("a")).toBe(1);
  });

  it("rejects snapshot writes once the materialized view exceeds the snapshot limit", () => {
    // Arrange
    const { ctx } = createRuntimeAndContext();
    const chunk = "x".repeat(220 * 1024);

    // Act
    ctx.set("chunk1", chunk);
    ctx.set("chunk2", chunk);
    ctx.set("chunk3", chunk);
    ctx.set("chunk4", chunk);
    ctx.set("chunk5", chunk);

    // Assert
    expect(() => ctx.snapshot()).toThrow(
      expect.objectContaining({
        code: ErrorCode.CONTEXT_SIZE_LIMIT_EXCEEDED,
      })
    );
  });

  it("successfully sets own __proto__ keys without prototype pollution and ensures failed writes are atomic", () => {
    // Arrange
    const { ctx } = createRuntimeAndContext();
    const payload = JSON.parse('{"__proto__":{"polluted":true},"ok":1}');

    // Act
    ctx.set("a.safe", payload);
    const snap = ctx.snapshot();

    // Assert
    expect(snap.a.safe.ok).toBe(1);
    expect(Object.getPrototypeOf(snap.a.safe)).toBe(Object.prototype);
    expect(Object.prototype.hasOwnProperty.call(snap.a.safe, "__proto__")).toBe(true);

    // Act/Assert for write atomicity using operations directly
    const store: any = {};
    expect(() => contextSet(store, ["nested", "path", "val"], undefined, "set", "nested.path.val")).toThrow();
    expect(store).toEqual({});

    expect(() => contextMerge(store, ["nested", "path", "val"], { x: undefined }, "merge", "nested.path.val")).toThrow();
    expect(store).toEqual({});

    expect(() => contextAppend(store, ["nested", "path", "val"], undefined, "append", "nested.path.val")).toThrow();
    expect(store).toEqual({});

    // Facade atomicity verification
    const { ctx: facadeCtx } = createRuntimeAndContext();
    expect(() => facadeCtx.set("failedParent.child", undefined)).toThrow();
    expect(facadeCtx.snapshot().failedParent).toBeUndefined();

    // Merge rejection test with spoofed custom prototype
    function FakeConstructor() {}
    Object.defineProperty(FakeConstructor, "name", { value: "Object" });
    const spoofedProto = { inherited: true };
    FakeConstructor.prototype = spoofedProto;
    (spoofedProto as any).constructor = FakeConstructor;
    const valueWithSpoofedProto = Object.create(spoofedProto);
    valueWithSpoofedProto.foo = "bar";

    // Facade merge check (will fail on validateJsonValue)
    const { ctx: mergeCtx } = createRuntimeAndContext();
    mergeCtx.set("mergeTarget", { initial: "value" });
    expect(() => mergeCtx.merge("mergeTarget", valueWithSpoofedProto)).toThrow(
      expect.objectContaining({
        code: ErrorCode.CONTEXT_INVALID_VALUE,
      })
    );
    expect(mergeCtx.get("mergeTarget")).toEqual({ initial: "value" });

    // Direct contextMerge check (will fail on isJsonPlainObject target/value validation)
    const rawStore = { mergeTarget: { initial: "value" } };
    expect(() =>
      contextMerge(rawStore, ["mergeTarget"], valueWithSpoofedProto, "merge", "mergeTarget")
    ).toThrow(
      expect.objectContaining({
        code: ErrorCode.CONTEXT_TYPE_MISMATCH,
      })
    );
    expect(rawStore.mergeTarget).toEqual({ initial: "value" });

    // Merge rejection test with cross-realm plain object
    const realmObject = vm.runInNewContext("({ foo: 'bar' })");

    // Facade merge check (will fail on validateJsonValue)
    const { ctx: mergeCtx2 } = createRuntimeAndContext();
    mergeCtx2.set("mergeTarget", { initial: "value" });
    expect(() => mergeCtx2.merge("mergeTarget", realmObject)).toThrow(
      expect.objectContaining({
        code: ErrorCode.CONTEXT_INVALID_VALUE,
      })
    );
    expect(mergeCtx2.get("mergeTarget")).toEqual({ initial: "value" });

    // Direct contextMerge check (will fail on isJsonPlainObject target/value validation)
    const rawStore2 = { mergeTarget: { initial: "value" } };
    expect(() =>
      contextMerge(rawStore2, ["mergeTarget"], realmObject, "merge", "mergeTarget")
    ).toThrow(
      expect.objectContaining({
        code: ErrorCode.CONTEXT_TYPE_MISMATCH,
      })
    );
    expect(rawStore2.mergeTarget).toEqual({ initial: "value" });
  });

  it("throws CONTEXT_MERGE_CONFLICT when deferred overlay appends into non-array target", async () => {
    // Arrange
    const runtime = createWorkflowContextRuntime({ runId: "test-run" });
    const ctx = runtime.createFacade();
    ctx.set("target", "not-an-array");

    const overlayResult = await runtime.runWithOverlay(
      {
        scopeId: "child-append",
        scopeType: "pipeline-stage",
        mergeMode: "deferred",
        mergeRules: { target: "append" },
      },
      async () => {
        const childCtx = runtime.createFacade();
        childCtx.append("target", "value");
      }
    );

    // Act & Assert
    expect(() => runtime.mergeOverlayResults([overlayResult])).toThrow(
      expect.objectContaining({
        code: ErrorCode.CONTEXT_MERGE_CONFLICT,
      })
    );
  });

  it("applies only append deltas on inherited arrays", async () => {
    // Arrange
    const runtime = createWorkflowContextRuntime({ runId: "test-run" });
    const ctx = runtime.createFacade();
    ctx.set("items", [1]);

    const overlayResult = await runtime.runWithOverlay(
      {
        scopeId: "child-overlay",
        scopeType: "pipeline-stage",
        mergeMode: "deferred",
        mergeRules: { items: "append" },
        inherit: ["items"],
      },
      async () => {
        const childCtx = runtime.createFacade();
        childCtx.append("items", 2);
      }
    );

    // Act
    runtime.mergeOverlayResults([overlayResult]);

    // Assert
    expect(ctx.get("items")).toEqual([1, 2]);
  });

  it("preserves multiple appends call order", async () => {
    // Arrange
    const runtime = createWorkflowContextRuntime({ runId: "test-run" });
    const ctx = runtime.createFacade();
    ctx.set("items", [1]);

    const overlayResult = await runtime.runWithOverlay(
      {
        scopeId: "child-overlay",
        scopeType: "pipeline-stage",
        mergeMode: "deferred",
        mergeRules: { items: "append" },
        inherit: ["items"],
      },
      async () => {
        const childCtx = runtime.createFacade();
        childCtx.append("items", 2);
        childCtx.append("items", 3);
      }
    );

    // Act
    runtime.mergeOverlayResults([overlayResult]);

    // Assert
    expect(ctx.get("items")).toEqual([1, 2, 3]);
  });

  it("appends full array values when child sets array on rule path", async () => {
    // Arrange
    const runtime = createWorkflowContextRuntime({ runId: "test-run" });
    const ctx = runtime.createFacade();
    ctx.set("items", [1]);

    const overlayResult = await runtime.runWithOverlay(
      {
        scopeId: "child-overlay",
        scopeType: "pipeline-stage",
        mergeMode: "deferred",
        mergeRules: { items: "append" },
      },
      async () => {
        const childCtx = runtime.createFacade();
        childCtx.set("items", [2, 3]);
      }
    );

    // Act
    runtime.mergeOverlayResults([overlayResult]);

    // Assert
    expect(ctx.get("items")).toEqual([1, 2, 3]);
  });
});
