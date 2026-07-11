import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { withInjectedToolRuntimeGlobals } from "../../../src/tools/runtime-globals.js";
import { activeToolRuntimeApi } from "../../../src/tools/runtime-api.js";
import { ErrorCode } from "../../../src/errors/codes.js";
import { OpenDynamicWorkflowError } from "../../../src/errors/types.js";

describe("runtime-globals", () => {
  let originalDescriptor: PropertyDescriptor | undefined;

  beforeEach(() => {
    originalDescriptor = Object.getOwnPropertyDescriptor(globalThis, "defineTool");
  });

  afterEach(() => {
    // Restore original globalThis.defineTool
    if (originalDescriptor) {
      try {
        Object.defineProperty(globalThis, "defineTool", originalDescriptor);
      } catch (e) {
        // If it was non-configurable and we can't define it, just try deleting and redefining
        try {
          Reflect.deleteProperty(globalThis, "defineTool");
          Object.defineProperty(globalThis, "defineTool", originalDescriptor);
        } catch (_) {}
      }
    } else {
      Reflect.deleteProperty(globalThis, "defineTool");
    }
  });

  it("should inject defineTool during callback and clean it up afterward on success", async () => {
    Reflect.deleteProperty(globalThis, "defineTool");

    let callbackCalled = false;
    const result = await withInjectedToolRuntimeGlobals(activeToolRuntimeApi, () => {
      callbackCalled = true;
      const desc = Object.getOwnPropertyDescriptor(globalThis, "defineTool");
      expect(desc).toBeDefined();
      expect(desc?.value).toBe(activeToolRuntimeApi.defineTool);
      expect(desc?.enumerable).toBe(false);
      expect(desc?.writable).toBe(false);
      expect(desc?.configurable).toBe(true);
      return "operation-success";
    });

    expect(callbackCalled).toBe(true);
    expect(result).toBe("operation-success");
    expect(Object.getOwnPropertyDescriptor(globalThis, "defineTool")).toBeUndefined();
  });

  it("should clean up injected global after synchronous throw", async () => {
    Reflect.deleteProperty(globalThis, "defineTool");

    const opPromise = withInjectedToolRuntimeGlobals(activeToolRuntimeApi, () => {
      throw new Error("sync-operation-error");
    });

    await expect(opPromise).rejects.toThrow("sync-operation-error");
    expect(Object.getOwnPropertyDescriptor(globalThis, "defineTool")).toBeUndefined();
  });

  it("should clean up injected global after asynchronous rejection", async () => {
    Reflect.deleteProperty(globalThis, "defineTool");

    const opPromise = withInjectedToolRuntimeGlobals(activeToolRuntimeApi, async () => {
      throw new Error("async-operation-error");
    });

    await expect(opPromise).rejects.toThrow("async-operation-error");
    expect(Object.getOwnPropertyDescriptor(globalThis, "defineTool")).toBeUndefined();
  });

  it("should shadow inherited defineTool property during session and restore it afterward", async () => {
    const inheritedFn = () => "inherited";
    
    // Add to prototype of Object to simulate inheritance
    Object.defineProperty(Object.prototype, "defineTool", {
      value: inheritedFn,
      configurable: true,
      writable: true,
      enumerable: true
    });

    try {
      expect((globalThis as any).defineTool).toBe(inheritedFn);
      expect(Object.getOwnPropertyDescriptor(globalThis, "defineTool")).toBeUndefined();

      let callbackCalled = false;
      await withInjectedToolRuntimeGlobals(activeToolRuntimeApi, () => {
        callbackCalled = true;
        expect((globalThis as any).defineTool).toBe(activeToolRuntimeApi.defineTool);
        expect(Object.getOwnPropertyDescriptor(globalThis, "defineTool")?.value).toBe(activeToolRuntimeApi.defineTool);
      });

      expect(callbackCalled).toBe(true);
      expect((globalThis as any).defineTool).toBe(inheritedFn);
      expect(Object.getOwnPropertyDescriptor(globalThis, "defineTool")).toBeUndefined();
    } finally {
      Reflect.deleteProperty(Object.prototype, "defineTool");
    }
  });

  it("should reuse identical own data binding without redefining or deleting it", async () => {
    Reflect.deleteProperty(globalThis, "defineTool");
    
    // Pre-define with different flags to verify they are not overwritten/re-defined
    Object.defineProperty(globalThis, "defineTool", {
      value: activeToolRuntimeApi.defineTool,
      enumerable: true,
      writable: true,
      configurable: true
    });

    let callbackCalled = false;
    await withInjectedToolRuntimeGlobals(activeToolRuntimeApi, () => {
      callbackCalled = true;
      const desc = Object.getOwnPropertyDescriptor(globalThis, "defineTool");
      expect(desc?.value).toBe(activeToolRuntimeApi.defineTool);
      expect(desc?.enumerable).toBe(true); // preserved
      expect(desc?.writable).toBe(true); // preserved
    });

    expect(callbackCalled).toBe(true);
    const postDesc = Object.getOwnPropertyDescriptor(globalThis, "defineTool");
    expect(postDesc).toBeDefined(); // NOT deleted because we did not install it
    expect(postDesc?.value).toBe(activeToolRuntimeApi.defineTool);
    expect(postDesc?.enumerable).toBe(true);
  });

  it("should reject foreign data descriptor with TOOL_INVALID_DEFINITION and preserve it", async () => {
    Reflect.deleteProperty(globalThis, "defineTool");
    const foreignFn = () => "foreign";
    Object.defineProperty(globalThis, "defineTool", {
      value: foreignFn,
      enumerable: true,
      writable: true,
      configurable: true
    });

    const beforeDesc = Object.getOwnPropertyDescriptor(globalThis, "defineTool");

    let callbackCalled = false;
    const opPromise = withInjectedToolRuntimeGlobals(activeToolRuntimeApi, () => {
      callbackCalled = true;
    });

    await expect(opPromise).rejects.toThrow(OpenDynamicWorkflowError);
    
    const err = await opPromise.catch(e => e);
    expect(err.code).toBe(ErrorCode.TOOL_INVALID_DEFINITION);
    expect(callbackCalled).toBe(false);

    const afterDesc = Object.getOwnPropertyDescriptor(globalThis, "defineTool");
    expect(afterDesc).toEqual(beforeDesc);
  });

  it("should reject accessor descriptor with TOOL_INVALID_DEFINITION without invoking getter", async () => {
    Reflect.deleteProperty(globalThis, "defineTool");
    let getterCalled = false;
    Object.defineProperty(globalThis, "defineTool", {
      get() {
        getterCalled = true;
        return () => {};
      },
      configurable: true,
      enumerable: true
    });

    const beforeDesc = Object.getOwnPropertyDescriptor(globalThis, "defineTool");

    let callbackCalled = false;
    const opPromise = withInjectedToolRuntimeGlobals(activeToolRuntimeApi, () => {
      callbackCalled = true;
    });

    await expect(opPromise).rejects.toThrow(OpenDynamicWorkflowError);
    
    const err = await opPromise.catch(e => e);
    expect(err.code).toBe(ErrorCode.TOOL_INVALID_DEFINITION);
    expect(callbackCalled).toBe(false);
    expect(getterCalled).toBe(false);

    const afterDesc = Object.getOwnPropertyDescriptor(globalThis, "defineTool");
    expect(afterDesc).toEqual(beforeDesc);
  });

  it("should handle defineProperty failure by throwing INTERNAL_ERROR", async () => {
    Reflect.deleteProperty(globalThis, "defineTool");

    const originalDefineProperty = Object.defineProperty;
    Object.defineProperty = function (obj: any, prop: any, descriptor: any) {
      if (obj === globalThis && prop === "defineTool") {
        throw new Error("mock defineProperty failure");
      }
      return originalDefineProperty.call(Object, obj, prop, descriptor);
    };

    try {
      const opPromise = withInjectedToolRuntimeGlobals(activeToolRuntimeApi, () => {});
      await expect(opPromise).rejects.toThrow(OpenDynamicWorkflowError);
      
      const err = await opPromise.catch(e => e);
      expect(err.code).toBe(ErrorCode.INTERNAL_ERROR);
      expect(err.cause?.message).toBe("mock defineProperty failure");
    } finally {
      Object.defineProperty = originalDefineProperty;
    }
  });

  it("should handle deleteProperty failure by throwing INTERNAL_ERROR with cleanupError as cause", async () => {
    Reflect.deleteProperty(globalThis, "defineTool");

    const originalDeleteProperty = Reflect.deleteProperty;
    Reflect.deleteProperty = function (target: any, propertyKey: any) {
      if (target === globalThis && propertyKey === "defineTool") {
        throw new Error("mock deleteProperty failure");
      }
      return originalDeleteProperty.call(Reflect, target, propertyKey);
    };

    try {
      const opPromise = withInjectedToolRuntimeGlobals(activeToolRuntimeApi, () => "success");
      await expect(opPromise).rejects.toThrow(OpenDynamicWorkflowError);
      
      const err = await opPromise.catch(e => e);
      expect(err.code).toBe(ErrorCode.INTERNAL_ERROR);
      expect(err.cause?.message).toBe("mock deleteProperty failure");
    } finally {
      Reflect.deleteProperty = originalDeleteProperty;
    }
  });

  it("should handle deleteProperty returning false by throwing INTERNAL_ERROR", async () => {
    Reflect.deleteProperty(globalThis, "defineTool");

    const originalDeleteProperty = Reflect.deleteProperty;
    Reflect.deleteProperty = function (target: any, propertyKey: any) {
      if (target === globalThis && propertyKey === "defineTool") {
        return false;
      }
      return originalDeleteProperty.call(Reflect, target, propertyKey);
    };

    try {
      const opPromise = withInjectedToolRuntimeGlobals(activeToolRuntimeApi, () => "success");
      await expect(opPromise).rejects.toThrow(OpenDynamicWorkflowError);
      
      const err = await opPromise.catch(e => e);
      expect(err.code).toBe(ErrorCode.INTERNAL_ERROR);
      expect(err.cause?.message).toBe("delete returned false");
    } finally {
      Reflect.deleteProperty = originalDeleteProperty;
    }
  });

  it("should prioritize callback error when both callback and cleanup fail", async () => {
    Reflect.deleteProperty(globalThis, "defineTool");

    const originalDeleteProperty = Reflect.deleteProperty;
    Reflect.deleteProperty = function (target: any, propertyKey: any) {
      if (target === globalThis && propertyKey === "defineTool") {
        throw new Error("mock deleteProperty failure");
      }
      return originalDeleteProperty.call(Reflect, target, propertyKey);
    };

    const callbackError = new Error("operation-failed-first");

    try {
      const opPromise = withInjectedToolRuntimeGlobals(activeToolRuntimeApi, () => {
        throw callbackError;
      });
      
      await expect(opPromise).rejects.toThrow(OpenDynamicWorkflowError);
      
      const err = await opPromise.catch(e => e);
      expect(err.code).toBe(ErrorCode.INTERNAL_ERROR);
      expect(err.cause).toBeInstanceOf(AggregateError);
      const aggErr = err.cause as AggregateError;
      expect(aggErr.errors[0].message).toBe("mock deleteProperty failure");
      expect(aggErr.errors[1]).toBe(callbackError);
    } finally {
      Reflect.deleteProperty = originalDeleteProperty;
    }
  });

  it("should fail restoration and keep foreign replacement if callback replaces the injected global with a foreign configurable property", async () => {
    Reflect.deleteProperty(globalThis, "defineTool");

    const foreignFn = () => "replaced-in-callback";
    const opPromise = withInjectedToolRuntimeGlobals(activeToolRuntimeApi, () => {
      Reflect.deleteProperty(globalThis, "defineTool");
      Object.defineProperty(globalThis, "defineTool", {
        value: foreignFn,
        enumerable: true,
        writable: true,
        configurable: true
      });
      return "callback-success";
    });

    await expect(opPromise).rejects.toThrow(OpenDynamicWorkflowError);
    const err = await opPromise.catch(e => e);
    expect(err.code).toBe(ErrorCode.INTERNAL_ERROR);
    expect(err.message).toContain("Failed to restore globalThis.defineTool after loading tools");

    const currentDesc = Object.getOwnPropertyDescriptor(globalThis, "defineTool");
    expect(currentDesc).toBeDefined();
    expect(currentDesc?.value).toBe(foreignFn);
    expect(currentDesc?.enumerable).toBe(true);
  });

  it("should propagate synchronous undefined throw exactly", async () => {
    Reflect.deleteProperty(globalThis, "defineTool");

    const opPromise = withInjectedToolRuntimeGlobals(activeToolRuntimeApi, () => {
      throw undefined;
    });

    await expect(opPromise).rejects.toBeUndefined();
    expect(Object.getOwnPropertyDescriptor(globalThis, "defineTool")).toBeUndefined();
  });

  it("should propagate asynchronous undefined rejection exactly", async () => {
    Reflect.deleteProperty(globalThis, "defineTool");

    const opPromise = withInjectedToolRuntimeGlobals(activeToolRuntimeApi, async () => {
      throw undefined;
    });

    await expect(opPromise).rejects.toBeUndefined();
    expect(Object.getOwnPropertyDescriptor(globalThis, "defineTool")).toBeUndefined();
  });

  it("should wrap both callback and cleanup failures in an AggregateError when both fail", async () => {
    Reflect.deleteProperty(globalThis, "defineTool");

    const callbackError = new Error("callback-failure");
    const foreignFn = () => "replaced";

    const opPromise = withInjectedToolRuntimeGlobals(activeToolRuntimeApi, () => {
      Reflect.deleteProperty(globalThis, "defineTool");
      Object.defineProperty(globalThis, "defineTool", {
        value: foreignFn,
        enumerable: true,
        writable: true,
        configurable: true
      });
      throw callbackError;
    });

    await expect(opPromise).rejects.toThrow(OpenDynamicWorkflowError);
    const err = await opPromise.catch(e => e);
    expect(err.code).toBe(ErrorCode.INTERNAL_ERROR);
    expect(err.cause).toBeInstanceOf(AggregateError);
    
    const aggErr = err.cause as AggregateError;
    expect(aggErr.errors.length).toBe(2);
    expect(aggErr.errors[0].message).toContain("Failed to restore globalThis.defineTool after loading tools: descriptor replaced or changed");
    expect(aggErr.errors[1]).toBe(callbackError);
  });

  it("should reject non-configurable foreign descriptor", async () => {
    Reflect.deleteProperty(globalThis, "defineTool");
    const foreignFn = () => "foreign-nonconf";
    Object.defineProperty(globalThis, "defineTool", {
      value: foreignFn,
      enumerable: true,
      writable: true,
      configurable: false
    });

    const beforeDesc = Object.getOwnPropertyDescriptor(globalThis, "defineTool");

    let callbackCalled = false;
    const opPromise = withInjectedToolRuntimeGlobals(activeToolRuntimeApi, () => {
      callbackCalled = true;
    });

    await expect(opPromise).rejects.toThrow(OpenDynamicWorkflowError);
    
    const err = await opPromise.catch(e => e);
    expect(err.code).toBe(ErrorCode.TOOL_INVALID_DEFINITION);
    expect(callbackCalled).toBe(false);

    const afterDesc = Object.getOwnPropertyDescriptor(globalThis, "defineTool");
    expect(afterDesc).toEqual(beforeDesc);
  });
});

