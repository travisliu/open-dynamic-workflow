import { describe, expect, it } from "vitest";
import { createRootFrame, createChildFrame, frameSet, frameAppend, frameMerge } from "../../../src/context/overlay.js";
import { mergeSingleFrame, detectGroupConflicts } from "../../../src/context/merge.js";
import { createWorkflowContextRuntime } from "../../../src/context/runtime.js";
import { ErrorCode } from "../../../src/errors/codes.js";

describe("Context Merge Engine", () => {
  it("supports replace, append, and merge strategies", () => {
    const root = createRootFrame("root", {
      str: "initial",
      arr: [1],
      obj: { a: 1 },
    });

    // 1. Test replace
    const childReplace = createChildFrame(
      {
        scopeId: "child-replace",
        scopeType: "workflow",
        mergeRules: { str: "replace" },
      },
      root
    );
    frameSet(childReplace, ["str"], "replaced", "str");
    const summaryReplace = mergeSingleFrame(root, childReplace);
    expect(summaryReplace.mergedPaths).toContain("str");
    expect(root.data.str).toBe("replaced");

    // 2. Test append
    const childAppend = createChildFrame(
      {
        scopeId: "child-append",
        scopeType: "workflow",
        mergeRules: { arr: "append" },
      },
      root
    );
    frameAppend(childAppend, ["arr"], 2, "arr");
    const summaryAppend = mergeSingleFrame(root, childAppend);
    expect(summaryAppend.mergedPaths).toContain("arr");
    expect(root.data.arr).toEqual([1, 2]);

    // 3. Test merge
    const childMerge = createChildFrame(
      {
        scopeId: "child-merge",
        scopeType: "workflow",
        mergeRules: { obj: "merge" },
      },
      root
    );
    frameMerge(childMerge, ["obj"], { b: 2 }, "obj");
    const summaryMerge = mergeSingleFrame(root, childMerge);
    expect(summaryMerge.mergedPaths).toContain("obj");
    expect(root.data.obj).toEqual({ a: 1, b: 2 });
  });

  it("rejects writes to paths without matching merge rules", () => {
    const root = createRootFrame("root", {
      allowed: "initial",
      unallowed: "initial",
    });

    const child = createChildFrame(
      {
        scopeId: "child",
        scopeType: "workflow",
        mergeRules: { allowed: "replace" },
      },
      root
    );

    frameSet(child, ["allowed"], "new-allowed", "allowed");
    frameSet(child, ["unallowed"], "new-unallowed", "unallowed");

    const summary = mergeSingleFrame(root, child);
    expect(summary.mergedPaths).toContain("allowed");
    expect(summary.rejectedPaths).toContain("unallowed");
    expect(summary.details?.["unallowed"]).toEqual({
      strategy: "replace",
      status: "rejected",
      reason: "merge_rule_required",
    });

    // Parent allowed is updated, but unallowed is not
    expect(root.data.allowed).toBe("new-allowed");
    expect(root.data.unallowed).toBe("initial");
  });

  it("handles rejectOnConflict correctly when parent path was modified since child startup", () => {
    const root = createRootFrame("root", {
      status: "initial",
    });

    const child = createChildFrame(
      {
        scopeId: "child",
        scopeType: "workflow",
        mergeRules: { status: "rejectOnConflict" },
      },
      root
    );

    // Child writes to status locally
    frameSet(child, ["status"], "child-update", "status");

    // Parent is modified in the meantime
    frameSet(root, ["status"], "parent-concurrent-update", "status");

    const summary = mergeSingleFrame(root, child);
    expect(summary.conflictPaths).toContain("status");
    expect(summary.details?.["status"].status).toBe("conflict");

    // Parent status remains unchanged by child
    expect(root.data.status).toBe("parent-concurrent-update");
  });

  it("detects sibling parallel branch conflicts deterministically", () => {
    const root = createRootFrame("root", {
      shared: "initial",
      mergeObj: { x: 1 },
    });

    // Sibling 1
    const child1 = createChildFrame(
      {
        scopeId: "child-1",
        scopeType: "parallel-branch",
        mergeRules: { shared: "replace" },
      },
      root
    );
    frameSet(child1, ["shared"], "value-1", "shared");

    // Sibling 2
    const child2 = createChildFrame(
      {
        scopeId: "child-2",
        scopeType: "parallel-branch",
        mergeRules: { shared: "replace" },
      },
      root
    );
    frameSet(child2, ["shared"], "value-2", "shared");

    // Group conflicts check should identify 'shared' path conflict
    const conflicts = detectGroupConflicts(root, [child1, child2]);
    expect(conflicts).toContain("shared");
  });

  it("allows parallel branch merge strategy to only conflict when they write different values for the same key", () => {
    const root = createRootFrame("root", {
      obj: { key1: 1, key2: 2 },
    });

    // Branch A sets key1 to 10
    const childA = createChildFrame(
      {
        scopeId: "branch-a",
        scopeType: "parallel-branch",
        mergeRules: { obj: "merge" },
      },
      root
    );
    frameMerge(childA, ["obj"], { key1: 10 }, "obj");

    // Branch B sets key2 to 20
    const childB = createChildFrame(
      {
        scopeId: "branch-b",
        scopeType: "parallel-branch",
        mergeRules: { obj: "merge" },
      },
      root
    );
    frameMerge(childB, ["obj"], { key2: 20 }, "obj");

    // Sibling merge rules: should not conflict since they modify different keys
    let conflicts = detectGroupConflicts(root, [childA, childB]);
    expect(conflicts).toEqual([]);

    // But if they write different values to the same key, it conflicts
    const childC = createChildFrame(
      {
        scopeId: "branch-c",
        scopeType: "parallel-branch",
        mergeRules: { obj: "merge" },
      },
      root
    );
    frameMerge(childC, ["obj"], { key1: 99 }, "obj");

    conflicts = detectGroupConflicts(root, [childA, childC]);
    expect(conflicts).toContain("obj.key1");
  });

  it("applies deferred group merges in order of orderKey and not completion order", async () => {
    const runtime = createWorkflowContextRuntime({ runId: "test-run" });

    // We execute three deferred overlays that complete in any order, but have defined orderKeys
    const res2 = await runtime.runWithOverlay(
      {
        scopeId: "branch-2",
        scopeType: "pipeline-stage",
        orderKey: 2,
        mergeMode: "deferred",
        mergeRules: { list: "append" },
      },
      async () => {
        const ctx = runtime.createFacade();
        ctx.append("list", "two");
      }
    );

    const res1 = await runtime.runWithOverlay(
      {
        scopeId: "branch-1",
        scopeType: "pipeline-stage",
        orderKey: 1,
        mergeMode: "deferred",
        mergeRules: { list: "append" },
      },
      async () => {
        const ctx = runtime.createFacade();
        ctx.append("list", "one");
      }
    );

    const res3 = await runtime.runWithOverlay(
      {
        scopeId: "branch-3",
        scopeType: "pipeline-stage",
        orderKey: 3,
        mergeMode: "deferred",
        mergeRules: { list: "append" },
      },
      async () => {
        const ctx = runtime.createFacade();
        ctx.append("list", "three");
      }
    );

    // Call group merge
    const summary = runtime.mergeOverlayResults([res2, res1, res3]);
    expect(summary.mergedPaths).toContain("list");

    const rootFacade = runtime.createFacade();
    expect(rootFacade.get("list")).toEqual(["one", "two", "three"]);
  });
});
