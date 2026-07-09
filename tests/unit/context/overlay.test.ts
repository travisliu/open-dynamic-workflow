import { describe, expect, it } from "vitest";
import { createRootFrame, createChildFrame, frameGet, frameSet, frameDelete, frameHas } from "../../../src/context/overlay.js";
import { applyInheritedPaths, normalizeInheritRules } from "../../../src/context/inheritance.js";
import { materializeSnapshot } from "../../../src/context/snapshot.js";

describe("Context Overlays", () => {
  it("allows child overlay to read inherited values but not un-inherited parent values", () => {
    const root = createRootFrame("root", {
      config: { plan: "enterprise", secret: "super-secret" },
    });

    const child = createChildFrame(
      {
        scopeId: "child-1",
        scopeType: "workflow",
        inherit: ["config.plan"],
      },
      root
    );

    const norm = normalizeInheritRules(child.inheritedPaths.length === 0 ? ["config.plan"] : []);
    applyInheritedPaths(root, child, norm);

    expect(frameHas(child, ["config", "plan"], "config.plan")).toBe(true);
    expect(frameGet(child, ["config", "plan"], "config.plan")).toBe("enterprise");

    expect(frameHas(child, ["config", "secret"], "config.secret")).toBe(false);
    expect(frameGet(child, ["config", "secret"], "config.secret")).toBeUndefined();
  });

  it("does not mutate parent on child writes before merge", () => {
    const root = createRootFrame("root", {
      data: { count: 1 },
    });

    const child = createChildFrame(
      {
        scopeId: "child-1",
        scopeType: "workflow",
        inherit: ["data"],
      },
      root
    );

    applyInheritedPaths(root, child, normalizeInheritRules(["data"]));

    // Child writes
    frameSet(child, ["data", "count"], 10, "data.count");
    frameSet(child, ["localVal"], "hello", "localVal");

    // Parent should be unchanged
    expect(frameGet(root, ["data", "count"], "data.count")).toBe(1);
    expect(frameGet(root, ["localVal"], "localVal")).toBeUndefined();

    // Child should have new values
    expect(frameGet(child, ["data", "count"], "data.count")).toBe(10);
    expect(frameGet(child, ["localVal"], "localVal")).toBe("hello");
  });

  it("creates local tombstone on delete", () => {
    const root = createRootFrame("root", {
      config: { plan: "pro" },
    });

    const child = createChildFrame(
      {
        scopeId: "child-1",
        scopeType: "workflow",
        inherit: ["config.plan"],
      },
      root
    );

    applyInheritedPaths(root, child, normalizeInheritRules(["config.plan"]));

    expect(frameHas(child, ["config", "plan"], "config.plan")).toBe(true);

    // Delete in child
    const deleted = frameDelete(child, ["config", "plan"], "config.plan");
    expect(deleted).toBe(true);

    expect(frameHas(child, ["config", "plan"], "config.plan")).toBe(false);
    expect(child.tombstones.has("config.plan")).toBe(true);
  });

  it("materializes active visible scope snapshot correctly", () => {
    const root = createRootFrame("root", {
      a: 1,
      b: { c: 2 },
    });

    const child = createChildFrame(
      {
        scopeId: "child-1",
        scopeType: "workflow",
        inherit: ["a"],
      },
      root
    );

    applyInheritedPaths(root, child, normalizeInheritRules(["a"]));
    frameSet(child, ["d"], 4, "d");

    const snap = materializeSnapshot(child, { metadata: true }) as any;
    expect(snap.values).toEqual({
      a: 1,
      d: 4,
    });
    expect(snap.metadata.scopeId).toBe("child-1");
    expect(snap.metadata.visibleScopes).toEqual(["root", "child-1"]);
    expect(snap.metadata.sourcePaths).toEqual({
      a: "root",
      d: "child-1",
    });
  });
});
