import * as vm from "node:vm";
import type { RuntimeState } from "./types.js";
import { createDsl } from "./dsl.js";

/**
 * Creates a restricted sandbox context for running a workflow.
 */
export function createSandboxContext(runtime: RuntimeState): vm.Context {
  const dsl = createDsl(runtime);

  const sandbox = {
    agent: dsl.agent,
    parallel: dsl.parallel,
    phase: dsl.phase,
    log: dsl.log,
    args: runtime.args,
    cwd: runtime.cwd,
    runId: runtime.runId,
    artifactsDir: runtime.artifactsDir,
    JSON,
    Array,
    Object,
    String,
    Number,
    Boolean,
    Promise,
    __default: undefined as any
  };

  return vm.createContext(sandbox);
}
