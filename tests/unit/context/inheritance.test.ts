import { describe, expect, it } from "vitest";
import { createRootFrame, createChildFrame, frameGet, frameSet } from "../../../src/context/overlay.js";
import { applyInheritedPaths, normalizeInheritRules } from "../../../src/context/inheritance.js";
import { ErrorCode } from "../../../src/errors/codes.js";

describe("Context Inheritance", () => {
  it("fails startup if required inherited path is missing in parent", () => {
    const root = createRootFrame("root", {
      config: { plan: "pro" },
    });

    const child = createChildFrame(
      {
        scopeId: "child-1",
        scopeType: "workflow",
        inherit: ["config.missingKey"],
      },
      root
    );

    const norm = normalizeInheritRules(child.inheritedPaths.length === 0 ? ["config.missingKey"] : []);
    expect(() => applyInheritedPaths(root, child, norm)).toThrow(
      expect.objectContaining({
        code: ErrorCode.CONTEXT_INHERIT_PATH_NOT_FOUND,
      })
    );
  });

  it("succeeds startup if optional inherited path is missing, and records in metadata", () => {
    const root = createRootFrame("root", {
      config: { plan: "pro" },
    });

    const child = createChildFrame(
      {
        scopeId: "child-1",
        scopeType: "workflow",
        inherit: [{ path: "config.missingKey", required: false }],
      },
      root
    );

    const norm = normalizeInheritRules([{ path: "config.missingKey", required: false }]);
    applyInheritedPaths(root, child, norm);

    expect(child.inheritedPaths).toContainEqual({
      path: "config.missingKey",
      required: false,
      found: false,
    });
    expect(frameGet(child, ["config", "missingKey"], "config.missingKey")).toBeUndefined();
  });

  it("ensures inherited object writes are copy-on-write and clone deeply", () => {
    const parentVal = { nested: { value: 1 } };
    const root = createRootFrame("root", {
      data: parentVal,
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

    // Mutate child nested property
    frameSet(child, ["data", "nested", "value"], 99, "data.nested.value");

    // Parent should not be mutated
    const parentRetrieved: any = frameGet(root, ["data"], "data");
    expect(parentRetrieved.nested.value).toBe(1);

    // Child should be mutated
    const childRetrieved: any = frameGet(child, ["data"], "data");
    expect(childRetrieved.nested.value).toBe(99);
  });

  it("normalizes and deduplicates inherit rules deterministically", () => {
    // Normalization of string vs object rules
    const rules = [
      "path.a",
      { path: "path.b", required: false },
      { path: "path.c" },
    ];
    const normalized = normalizeInheritRules(rules);
    expect(normalized).toEqual([
      { path: "path.a", required: true },
      { path: "path.b", required: false },
      { path: "path.c", required: true },
    ]);

    // Reject exact duplicates
    expect(() => normalizeInheritRules(["dup.path", "dup.path"])).toThrow(
      expect.objectContaining({
        code: ErrorCode.CONTEXT_INVALID_PATH,
      })
    );
  });
});
