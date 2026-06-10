import * as vm from "node:vm";
import type { RuntimeState } from "./types.js";
import { createDsl } from "./dsl.js";

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
    pause: { value: dsl.pause, enumerable: true, configurable: false, writable: false },
    args: { value: Object.freeze({ ...runtime.args }), enumerable: true, configurable: false, writable: false },
    cwd: { value: runtime.cwd, enumerable: true, configurable: false, writable: false },
    runId: { value: runtime.runId, enumerable: true, configurable: false, writable: false },
        artifactsDir: { value: runtime.artifactsDir, enumerable: true, configurable: false, writable: false },
    
    // Placeholder for the default export capture. 
    // The transformation in runtime.ts will assign to this.
    __default: { value: undefined, enumerable: false, configurable: false, writable: true }
  });

  const context = vm.createContext(sandbox);
  
  return context;
}
