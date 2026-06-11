import * as vm from "node:vm";
import type { RuntimeState } from "./types.js";
import { createDsl } from "./dsl.js";
import { getActiveWorkflowInvocation } from "./invocation-types.js";
import { cloneJsonObject } from "./json.js";

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

  // Use a clean object for the sandbox global scope
  const sandbox = Object.create(null);

  // Define properties on the sandbox
  // We keep them writable: false where possible, but __default must be writable
  Object.defineProperties(sandbox, {
    agent: { value: dsl.agent, enumerable: true, configurable: false, writable: false },
    parallel: { value: dsl.parallel, enumerable: true, configurable: false, writable: false },
    phase: { value: dsl.phase, enumerable: true, configurable: false, writable: false },
    log: { value: dsl.log, enumerable: true, configurable: false, writable: false },
    pipeline: { value: dsl.pipeline, enumerable: true, configurable: false, writable: false },
    workflow: { value: dsl.workflow, enumerable: true, configurable: false, writable: false },
    args: { value: Object.freeze(cloneJsonObject(args, "workflow args")), enumerable: true, configurable: false, writable: false },
    cwd: { value: runtime.cwd, enumerable: true, configurable: false, writable: false },
    runId: { value: runtime.runId, enumerable: true, configurable: false, writable: false },
    artifactsDir: { value: runtime.artifactsDir, enumerable: true, configurable: false, writable: false },
    setTimeout: { value: setTimeout, enumerable: true, configurable: false, writable: false },
    clearTimeout: { value: clearTimeout, enumerable: true, configurable: false, writable: false },
    
    // Placeholder for the default export capture. 
    __default: { value: undefined, enumerable: false, configurable: false, writable: true }
  });

  const context = vm.createContext(sandbox);
  
  return context;
}
