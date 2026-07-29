import * as vm from "node:vm";
import type { RuntimeState } from "./types.js";
import { createDsl } from "./dsl.js";
import { getActiveWorkflowInvocation } from "./invocation-types.js";
import { cloneJsonObject } from "./json.js";
import { withToolForbidden } from "./scope.js";
import { OpenDynamicWorkflowError } from "../errors/types.js";
import { ErrorCode } from "../errors/codes.js";

/**
 * Creates a restricted sandbox context for running a workflow.
 * 
 * Safety model:
 * 1. We use a fresh VM context which provides its own globals (Object, Array, etc.)
 *    that are distinct from the host's versions. This prevents simple prototype
 *    pollution and constructor.constructor escapes back to host Function.
 * 2. We only expose safe, necessary DSL functions and data.
 * 3. We do not provide host-level modules like 'fs' or 'process'.
 * 4. The sandbox object itself is frozen after setup to prevent modifications to the global scope.
 */
export function createSandboxContext(runtime: RuntimeState): vm.Context {
  const dsl = createDsl(runtime);
  const activeInvocation = getActiveWorkflowInvocation();
  const args = activeInvocation ? activeInvocation.args : runtime.args;
  const contextFacade = createSandboxContextFacade(runtime.contextRuntime.createFacade());

  // Use a clean object for the sandbox global scope
  const sandbox = Object.create(null);

  // Wrap Promise to forbid tool calls in callbacks
  const OriginalPromise = Promise;
  class WrappedPromise<T> extends OriginalPromise<T> {
    override then<TResult1 = T, TResult2 = never>(
      onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | undefined | null,
      onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | undefined | null
    ): Promise<TResult1 | TResult2> {
      const wrappedOnFulfilled = onfulfilled 
        ? (value: T) => withToolForbidden("asynchronous-callback", () => onfulfilled(value))
        : undefined;
      const wrappedOnRejected = onrejected 
        ? (reason: any) => withToolForbidden("asynchronous-callback", () => onrejected(reason))
        : undefined;
      return super.then(wrappedOnFulfilled as any, wrappedOnRejected as any);
    }

    override catch<TResult = never>(
      onrejected?: ((reason: any) => TResult | PromiseLike<TResult>) | undefined | null
    ): Promise<T | TResult> {
      const wrappedOnRejected = onrejected 
        ? (reason: any) => withToolForbidden("asynchronous-callback", () => onrejected(reason))
        : undefined;
      return super.catch(wrappedOnRejected as any);
    }

    override finally(onfinally?: (() => void) | undefined | null): Promise<T> {
      const wrappedOnFinally = onfinally 
        ? () => withToolForbidden("asynchronous-callback", () => onfinally())
        : undefined;
      return super.finally(wrappedOnFinally);
    }
  }

  // Define properties on the sandbox
  // We keep them writable: false where possible, but __default must be writable
  Object.defineProperties(sandbox, {
    agent: { value: dsl.agent, enumerable: true, configurable: false, writable: false },
    tool: { value: dsl.tool, enumerable: true, configurable: false, writable: false },
    parallel: { value: dsl.parallel, enumerable: true, configurable: false, writable: false },
    phase: { value: dsl.phase, enumerable: true, configurable: false, writable: false },
    log: { value: dsl.log, enumerable: true, configurable: false, writable: false },
    pipeline: { value: dsl.pipeline, enumerable: true, configurable: false, writable: false },
    workflow: { value: dsl.workflow, enumerable: true, configurable: false, writable: false },
    loop: { value: dsl.loop, enumerable: true, configurable: false, writable: false },
    args: { value: Object.freeze(cloneJsonObject(args, "workflow args")), enumerable: true, configurable: false, writable: false },
    cwd: { value: runtime.cwd, enumerable: true, configurable: false, writable: false },
    runId: { value: runtime.runId, enumerable: true, configurable: false, writable: false },
    artifactsDir: { value: runtime.artifactsDir, enumerable: true, configurable: false, writable: false },
    context: { value: contextFacade, enumerable: true, configurable: false, writable: false },
    signal: {
      get: () => {
        const activeInvocation = getActiveWorkflowInvocation();
        return activeInvocation?.signal || runtime.abortController.signal;
      },
      enumerable: true,
      configurable: false
    },
    setTimeout: { 
      value: (fn: any, ms?: number, ...args: any[]) => {
        if (typeof fn !== "function") {
          return setTimeout(fn, ms, ...args);
        }
        return setTimeout(() => withToolForbidden("asynchronous-callback", () => fn(...args)), ms);
      },
      enumerable: true, configurable: false, writable: false 
    },
    clearTimeout: { value: clearTimeout, enumerable: true, configurable: false, writable: false },
    Promise: { value: WrappedPromise, enumerable: true, configurable: false, writable: false },
    
    // Placeholder for the default export capture. 
    __default: { value: undefined, enumerable: false, configurable: false, writable: true }
  });

  // Node 20's contextified global proxy reports false from
  // Object.prototype.propertyIsEnumerable even for enumerable own properties.
  // Keep globalThis limited to already exposed bindings while preserving aliases.
  const globalThisFacade = Object.create(null);
  for (const key of [
    "agent", "tool", "parallel", "phase", "log", "pipeline", "workflow", "loop",
    "args", "cwd", "runId", "artifactsDir", "context", "signal", "setTimeout", "clearTimeout", "Promise"
  ]) {
    Object.defineProperty(globalThisFacade, key, Object.getOwnPropertyDescriptor(sandbox, key)!);
  }
  Object.defineProperty(globalThisFacade, "globalThis", {
    value: globalThisFacade,
    enumerable: false,
    configurable: false,
    writable: false
  });
  Object.freeze(globalThisFacade);
  Object.defineProperty(sandbox, "globalThis", {
    value: globalThisFacade,
    enumerable: false,
    configurable: false,
    writable: false
  });

  const context = vm.createContext(sandbox);
  
  return context;
}

function cloneContextValueBoundary(
  value: unknown,
  seen: Set<unknown>,
  operation: string,
  path: string
): unknown {
  if (value === undefined) {
    throw new OpenDynamicWorkflowError(
      ErrorCode.CONTEXT_INVALID_VALUE,
      `Context operation '${operation}' failed for path '${path}': value cannot be undefined`
    );
  }
  if (value === null) {
    return null;
  }

  const type = typeof value;
  if (type === "boolean" || type === "string") {
    return value;
  }
  if (type === "number") {
    if (!Number.isFinite(value)) {
      throw new OpenDynamicWorkflowError(
        ErrorCode.CONTEXT_INVALID_VALUE,
        `Context operation '${operation}' failed for path '${path}': number must be finite (received ${value})`
      );
    }
    return value;
  }
  if (type === "bigint" || type === "symbol" || type === "function") {
    throw new OpenDynamicWorkflowError(
      ErrorCode.CONTEXT_INVALID_VALUE,
      `Context operation '${operation}' failed for path '${path}': type ${type} is not JSON-safe`
    );
  }

  if (type === "object") {
    if (seen.has(value)) {
      throw new OpenDynamicWorkflowError(
        ErrorCode.CONTEXT_INVALID_VALUE,
        `Context operation '${operation}' failed for path '${path}': cyclic object structure detected`
      );
    }
    seen.add(value);

    if (Array.isArray(value)) {
      const descriptors = Object.getOwnPropertyDescriptors(value);
      for (const key of Object.keys(descriptors)) {
        const desc = descriptors[key];
        if (desc && (desc.get || desc.set)) {
          throw new OpenDynamicWorkflowError(
            ErrorCode.CONTEXT_INVALID_VALUE,
            `Context operation '${operation}' failed for path '${path}': property '${key}' contains accessors`
          );
        }
      }

      const clonedArr: unknown[] = [];
      for (let i = 0; i < value.length; i++) {
        const desc = descriptors[String(i)];
        const val = desc ? desc.value : undefined;
        clonedArr.push(cloneContextValueBoundary(val, seen, operation, `${path}[${i}]`));
      }
      seen.delete(value);
      return clonedArr;
    }

    // Verify if it is a VM-realm or host-realm plain object
    const proto = Object.getPrototypeOf(value);
    const isValidPlainObject =
      proto === null ||
      (proto !== null && Object.getPrototypeOf(proto) === null);

    if (!isValidPlainObject) {
      let constructorName = "unknown";
      try {
        constructorName = proto?.constructor?.name || "unknown";
      } catch {
        constructorName = "unknown (getter threw)";
      }
      throw new OpenDynamicWorkflowError(
        ErrorCode.CONTEXT_INVALID_VALUE,
        `Context operation '${operation}' failed for path '${path}': value is not a plain object or array (prototype: ${constructorName})`
      );
    }

    const descriptors = Object.getOwnPropertyDescriptors(value as object);
    for (const key of Object.keys(descriptors)) {
      const desc = descriptors[key];
      if (desc && (desc.get || desc.set)) {
        throw new OpenDynamicWorkflowError(
          ErrorCode.CONTEXT_INVALID_VALUE,
          `Context operation '${operation}' failed for path '${path}': property '${key}' contains accessors`
        );
      }
    }

    // Perform thenable detection from descriptors, not property reads
    const thenDesc = descriptors["then"];
    if (thenDesc && typeof thenDesc.value === "function") {
      throw new OpenDynamicWorkflowError(
        ErrorCode.CONTEXT_INVALID_VALUE,
        `Context operation '${operation}' failed for path '${path}': value contains a Promise or thenable`
      );
    }

    const clonedObj = proto === null ? Object.create(null) : {};
    const keys = Object.keys(value as object);
    for (const key of keys) {
      const desc = descriptors[key];
      const val = desc ? desc.value : undefined;
      if (val === undefined) {
        continue;
      }
      Object.defineProperty(clonedObj, key, {
        value: cloneContextValueBoundary(val, seen, operation, `${path}.${key}`),
        enumerable: true,
        writable: true,
        configurable: true
      });
    }
    seen.delete(value);
    return clonedObj;
  }

  throw new OpenDynamicWorkflowError(
    ErrorCode.CONTEXT_INVALID_VALUE,
    `Context operation '${operation}' failed for path '${path}': type ${type} is not JSON-safe`
  );
}

function sanitizeContextValue(value: unknown, operation: string, path: string): unknown {
  return cloneContextValueBoundary(value, new Set(), operation, path);
}

export function createSandboxContextFacade(facade: any): any {
  return {
    get(path: string) {
      return facade.get(path);
    },
    has(path: string) {
      return facade.has(path);
    },
    set(path: string, value: any) {
      return facade.set(path, sanitizeContextValue(value, "set", path));
    },
    delete(path: string) {
      return facade.delete(path);
    },
    merge(path: string, value: any) {
      return facade.merge(path, sanitizeContextValue(value, "merge", path));
    },
    append(path: string, value: any) {
      return facade.append(path, sanitizeContextValue(value, "append", path));
    },
    snapshot(options?: any) {
      return facade.snapshot(options);
    },
    scope(path: string, fn: any) {
      return facade.scope(path, fn);
    }
  };
}
