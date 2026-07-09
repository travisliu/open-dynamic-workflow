import { describe, expect, it } from "vitest";
import { createWorkflowContextRuntime } from "../../../src/context/runtime.js";
import { parseContextPath } from "../../../src/context/path.js";
import { seedProfileContext, validateProfileContextSeed } from "../../../src/context/profile-seed.js";
import { ErrorCode } from "../../../src/errors/codes.js";
import type { RuntimeProfileContextSeed } from "../../../src/types/config.js";

describe("Profile Context Seeding", () => {
  const validSeed: RuntimeProfileContextSeed = {
    context: {
      mode: "dev",
      quality: { level: "high" }
    },
    metadata: {
      name: "my-profile",
      source: "external",
      hasExternalFile: true,
      hash: "abc123hash"
    },
    reservedPath: "$profile"
  };

  it("seeds top-level and nested context values readable through normal facade get() paths", () => {
    const runtime = createWorkflowContextRuntime({ runId: "test-run" });
    seedProfileContext({ contextRuntime: runtime, seed: validSeed });
    const facade = runtime.createFacade();

    expect(facade.get("mode")).toBe("dev");
    expect(facade.get("quality.level")).toBe("high");
    expect(facade.get("quality")).toEqual({ level: "high" });
  });

  it("makes $profile metadata readable and proves path validator permits $profile", () => {
    // Prove the path validator permits $profile.name
    const parsed = parseContextPath("$profile.name", { operation: "get" });
    expect(parsed.normalized).toBe("$profile.name");
    expect(parsed.segments).toEqual(["$profile", "name"]);

    const runtime = createWorkflowContextRuntime({ runId: "test-run" });
    seedProfileContext({ contextRuntime: runtime, seed: validSeed });
    const facade = runtime.createFacade();

    expect(facade.get("$profile.name")).toBe("my-profile");
    expect(facade.get("$profile.source")).toBe("external");
    expect(facade.get("$profile.hasExternalFile")).toBe(true);
    expect(facade.get("$profile.hash")).toBe("abc123hash");
    expect(facade.get("$profile")).toEqual({
      name: "my-profile",
      source: "external",
      hasExternalFile: true,
      hash: "abc123hash"
    });
  });

  it("rejects an own top-level context.$profile key before writing any metadata", () => {
    const invalidSeed = {
      ...validSeed,
      context: {
        ...validSeed.context,
        $profile: { name: "attacker" }
      }
    };

    const runtime = createWorkflowContextRuntime({ runId: "test-run" });
    let error: any;
    try {
      seedProfileContext({ contextRuntime: runtime, seed: invalidSeed as any });
    } catch (e: any) {
      error = e;
    }

    expect(error).toBeDefined();
    expect(error.code).toBe(ErrorCode.PROFILE_RESERVED_PATH);
    expect(runtime.createFacade().get("mode")).toBeUndefined();
  });

  it("rejects invalid JSON/metadata/reserved-path input with typed errors", () => {
    // 1. Invalid reservedPath
    expect(() => {
      validateProfileContextSeed({ ...validSeed, reservedPath: "wrong" as any });
    }).toThrow(/Reserved path must be '\$profile'/);

    try {
      validateProfileContextSeed({ ...validSeed, reservedPath: "wrong" as any });
    } catch (e: any) {
      expect(e.code).toBe(ErrorCode.PROFILE_RESERVED_PATH);
    }

    // 2. Missing metadata name
    expect(() => {
      validateProfileContextSeed({
        ...validSeed,
        metadata: { ...validSeed.metadata, name: "" }
      });
    }).toThrow(/name/);

    try {
      validateProfileContextSeed({
        ...validSeed,
        metadata: { ...validSeed.metadata, name: "" }
      });
    } catch (e: any) {
      expect(e.code).toBe(ErrorCode.PROFILE_CONTEXT_INVALID);
    }

    // 3. Invalid metadata source
    expect(() => {
      validateProfileContextSeed({
        ...validSeed,
        metadata: { ...validSeed.metadata, source: "invalid-source" as any }
      });
    }).toThrow(/source/);

    // 4. Invalid context (not a plain object)
    expect(() => {
      validateProfileContextSeed({
        ...validSeed,
        context: [] as any
      });
    }).toThrow(/plain object/);

    // 5. Cyclic/unsafe JSON in context
    const cyclicContext: any = {};
    cyclicContext.self = cyclicContext;
    expect(() => {
      validateProfileContextSeed({
        ...validSeed,
        context: cyclicContext
      });
    }).toThrow(/JSON-safe/);
  });

  it("clones values and passes existing limits rather than sharing references", () => {
    const runtime = createWorkflowContextRuntime({ runId: "test-run" });
    const originalObj = { val: "test" };
    const seedWithRef = {
      ...validSeed,
      context: {
        nested: originalObj
      }
    };

    seedProfileContext({ contextRuntime: runtime, seed: seedWithRef });
    const facade = runtime.createFacade();

    const retrieved: any = facade.get("nested");
    expect(retrieved).toEqual(originalObj);
    expect(retrieved).not.toBe(originalObj); // must be cloned
  });
});
