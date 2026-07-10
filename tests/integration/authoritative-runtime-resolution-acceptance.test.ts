import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import { main } from "../../src/cli/index.js";
import { ErrorCode } from "../../src/errors/codes.js";
import { exitCodeForError } from "../../src/errors/exit-codes.js";
import * as selectionService from "../../src/agents/resolve-provider-selection.js";

const TEMP_DIR = path.resolve("tests/temp-authoritative-runtime-resolution-acceptance");

async function runCli(args: string[]) {
  const stdoutData: string[] = [];
  const stderrData: string[] = [];

  const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
    stdoutData.push(chunk.toString());
    return true;
  });
  const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
    stderrData.push(chunk.toString());
    return true;
  });
  const logSpy = vi.spyOn(console, "log").mockImplementation((...args) => {
    stdoutData.push(args.join(" ") + "\n");
  });
  const errorSpy = vi.spyOn(console, "error").mockImplementation((...args) => {
    stderrData.push(args.join(" ") + "\n");
  });

  let error: any = null;
  try {
    await main(["node", "open-dynamic-workflow", ...args]);
  } catch (err) {
    error = err;
  } finally {
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
    logSpy.mockRestore();
    errorSpy.mockRestore();
  }

  return {
    stdout: stdoutData.join(""),
    stderr: stderrData.join(""),
    error
  };
}

describe("Phase 2: Authoritative Runtime Resolution AAA Acceptance Tests", () => {
  let configPath: string;
  let invalidConfigPath: string;

  beforeEach(async () => {
    // -------------------------------------------------------------
    // ARRANGE: Setup temporary directory, configuration files,
    // and workflow files.
    // -------------------------------------------------------------
    await fs.rm(TEMP_DIR, { recursive: true, force: true });
    await fs.mkdir(TEMP_DIR, { recursive: true });
    await fs.mkdir(path.join(TEMP_DIR, "workflows"), { recursive: true });
    await fs.mkdir(path.join(TEMP_DIR, ".open-dynamic-workflow/agents"), { recursive: true });

    configPath = path.join(TEMP_DIR, "config.yaml");
    invalidConfigPath = path.join(TEMP_DIR, "invalid-config.yaml");

    const fakeProviderPath = path.resolve("tests/fixtures/providers/fake-provider-cli.mjs");

    // Standard configuration with provider definitions, aliases, and default provider settings
    await fs.writeFile(configPath, `
defaultProvider: alias-default
concurrency: 1
timeoutMs: 8000
providers:
  mock:
    command: mock
    defaultModel: "provider-mock-model"
  gemini:
    command: node
    args:
      - "${fakeProviderPath}"
    defaultModel: "gemini-3.5-flash"
    modelArg:
      flag: --model
providerAliases:
  alias-default:
    provider: mock
    model: "alias-mock-model"
    timeoutMs: 4000
    retry:
      maxAttempts: 2
      delayMs: 150
  alias-gemini:
    provider: gemini
    model: "gemini-alias-model"
  alias-null-model:
    provider: gemini
    model: null
sharedAgents:
  dir: .open-dynamic-workflow/agents
workflow:
  discovery:
    include:
      - "workflows/**/*.js"
`);

    // Invalid configuration to check PROVIDER_REFERENCE_NOT_FOUND
    await fs.writeFile(invalidConfigPath, `
defaultProvider: non-existent-alias-provider
providers:
  mock:
    command: mock
`);

    // 1. Direct agent call using alias
    await fs.writeFile(path.join(TEMP_DIR, "workflows/direct.workflow.js"), `
export const meta = { name: "direct-flow", description: "Direct flow description" };
export default async () => {
  const res = await agent({
    id: "direct-agent",
    prompt: "hello direct",
    provider: "alias-gemini"
  });
  return { res };
};
`);

    // 2. Shared agent call
    await fs.writeFile(path.join(TEMP_DIR, ".open-dynamic-workflow/agents/custom.agent.js"), `
export default defineAgent({
  id: "custom-agent",
  inputSchema: { type: "object" },
  run: async (context, runtime) => {
    return await runtime.agent({
      id: "inner-agent",
      prompt: "inner prompt",
      provider: "alias-gemini"
    });
  }
});
`);

    await fs.writeFile(path.join(TEMP_DIR, "workflows/shared.workflow.js"), `
export const meta = { name: "shared-flow", description: "Shared flow description" };
export default async () => {
  const res = await agent({
    definition: "custom-agent"
  });
  return { res };
};
`);

    // 3. Parallel agent calls using aliases
    await fs.writeFile(path.join(TEMP_DIR, "workflows/parallel.workflow.js"), `
export const meta = { name: "parallel-flow", description: "Parallel flow description" };
export default async () => {
  return await parallel([
    async () => await agent({ id: "p1", prompt: "p1 prompt", provider: "alias-gemini" }),
    async () => await agent({ id: "p2", prompt: "p2 prompt", provider: "alias-gemini" })
  ]);
};
`);

    // 4. Pipeline agent call using alias
    await fs.writeFile(path.join(TEMP_DIR, "workflows/pipeline.workflow.js"), `
export const meta = { name: "pipeline-flow", description: "Pipeline flow description" };
export default async () => {
  return await pipeline(["item"], [
    {
      name: "stage1",
      run: async (item, ctx) => {
        return await ctx.agent({
          id: "pipeline-agent",
          prompt: "pipeline prompt",
          provider: "alias-gemini"
        });
      }
    }
  ]);
};
`);

    // 5. Loop agent call using alias
    await fs.writeFile(path.join(TEMP_DIR, "workflows/loop.workflow.js"), `
export const meta = { name: "loop-flow", description: "Loop flow description" };
export default async () => {
  return await loop({
    label: "loop-flow",
    initialState: {},
    options: { maxRounds: 1 },
    run: async (state, ctx) => {
      const out = await ctx.agent({
        id: "loop-agent",
        prompt: "loop prompt",
        provider: "alias-gemini"
      });
      return { done: true, nextState: out };
    }
  });
};
`);

    // 6. Child parent & child sub workflows
    await fs.writeFile(path.join(TEMP_DIR, "workflows/child-sub.workflow.js"), `
export const meta = { name: "child-sub", description: "Child sub description" };
export default async () => {
  return await agent({
    id: "child-agent",
    prompt: "child prompt",
    provider: "alias-gemini"
  });
};
`);

    await fs.writeFile(path.join(TEMP_DIR, "workflows/child-parent.workflow.js"), `
export const meta = { name: "child-parent", description: "Child parent description" };
export default async () => {
  return await workflow({ name: "child-sub" });
};
`);

    // 7. Workflow with null model
    await fs.writeFile(path.join(TEMP_DIR, "workflows/null-model.workflow.js"), `
export const meta = { name: "null-model-flow", description: "Null model description" };
export default async () => {
  return await agent({
    id: "null-model-agent",
    prompt: "null model prompt",
    provider: "alias-null-model"
  });
};
`);

    // 8. Workflow with unknown literal provider reference
    await fs.writeFile(path.join(TEMP_DIR, "workflows/invalid-literal.workflow.js"), `
export const meta = { name: "invalid-literal-flow", description: "Invalid literal description" };
export default async () => {
  return await agent({
    id: "invalid-agent",
    prompt: "invalid prompt",
    provider: "unknown-literal-alias"
  });
};
`);
  });

  afterEach(async () => {
    await fs.rm(TEMP_DIR, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("exercises direct, shared, parallel, pipeline, loop, child, dry-run, doctor, and validate flows, asserting authoritative resolution behavior", async () => {
    // Spy on the provider selection service to verify it resolves exactly once per logical call
    const selectionSpy = vi.spyOn(selectionService, "resolveProviderSelection");

    // -------------------------------------------------------------
    // ACT & ASSERT: Scenario 1 - Direct flow
    // -------------------------------------------------------------
    selectionSpy.mockClear();
    const directResult = await runCli([
      "run",
      path.join(TEMP_DIR, "workflows/direct.workflow.js"),
      "--config", configPath,
      "--out", path.join(TEMP_DIR, "runs"),
      "--cwd", TEMP_DIR,
      "--report", "json"
    ]);

    expect(directResult.error).toBeNull();
    // Selection service is called exactly once for this agent call
    expect(selectionSpy).toHaveBeenCalledTimes(1);

    const runsDirect = await fs.readdir(path.join(TEMP_DIR, "runs"));
    const reportDirect = JSON.parse(await fs.readFile(path.join(TEMP_DIR, "runs", runsDirect[0]!, "report.json"), "utf8"));
    const agentDirect = reportDirect.agents.find((a: any) => a.id === "direct-agent");
    
    // Assert downstream provider is concrete, providerSelection metadata is preserved, and precedence is matched
    expect(agentDirect.provider).toBe("gemini");
    expect(agentDirect.model).toBe("gemini-alias-model");
    expect(agentDirect.providerSelection).toBeDefined();
    expect(agentDirect.providerSelection.selection.requestedProvider).toBe("alias-gemini");
    expect(agentDirect.providerSelection.selection.resolvedProvider).toBe("gemini");
    expect(agentDirect.providerSelection.selection.providerAlias).toBe("alias-gemini");
    expect(agentDirect.providerSelection.resolvedExecution.model).toBe("gemini-alias-model");

    // Assert downstream command receives only concrete provider settings (no alias string in argv)
    const directStderrLogPath = path.join(TEMP_DIR, "runs", runsDirect[0]!, "agents/direct-agent/stderr.log");
    const directStderrLog = JSON.parse(await fs.readFile(directStderrLogPath, "utf8"));
    expect(JSON.stringify(directStderrLog.argv)).not.toContain("alias-gemini");
    expect(JSON.stringify(directStderrLog.argv)).toContain("gemini-alias-model");

    // -------------------------------------------------------------
    // ACT & ASSERT: Scenario 2 - Shared agent flow
    // -------------------------------------------------------------
    selectionSpy.mockClear();
    await fs.rm(path.join(TEMP_DIR, "runs"), { recursive: true, force: true });
    const sharedResult = await runCli([
      "run",
      path.join(TEMP_DIR, "workflows/shared.workflow.js"),
      "--config", configPath,
      "--out", path.join(TEMP_DIR, "runs"),
      "--cwd", TEMP_DIR,
      "--report", "json"
    ]);

    expect(sharedResult.error).toBeNull();
    // Selection service is called exactly once for the inner agent execution (custom-agent itself is definition-based)
    expect(selectionSpy).toHaveBeenCalledTimes(1);

    const runsShared = await fs.readdir(path.join(TEMP_DIR, "runs"));
    const reportShared = JSON.parse(await fs.readFile(path.join(TEMP_DIR, "runs", runsShared[0]!, "report.json"), "utf8"));
    const agentShared = reportShared.agents.find((a: any) => a.id === "inner-agent");
    expect(agentShared.provider).toBe("gemini");
    expect(agentShared.providerSelection.selection.requestedProvider).toBe("alias-gemini");

    // -------------------------------------------------------------
    // ACT & ASSERT: Scenario 3 - Parallel flow
    // -------------------------------------------------------------
    selectionSpy.mockClear();
    await fs.rm(path.join(TEMP_DIR, "runs"), { recursive: true, force: true });
    const parallelResult = await runCli([
      "run",
      path.join(TEMP_DIR, "workflows/parallel.workflow.js"),
      "--config", configPath,
      "--out", path.join(TEMP_DIR, "runs"),
      "--cwd", TEMP_DIR,
      "--report", "json"
    ]);

    expect(parallelResult.error).toBeNull();
    // Selection service resolves exactly once per agent call in the parallel array
    expect(selectionSpy).toHaveBeenCalledTimes(2);

    const runsParallel = await fs.readdir(path.join(TEMP_DIR, "runs"));
    const reportParallel = JSON.parse(await fs.readFile(path.join(TEMP_DIR, "runs", runsParallel[0]!, "report.json"), "utf8"));
    const p1Agent = reportParallel.agents.find((a: any) => a.id === "p1");
    const p2Agent = reportParallel.agents.find((a: any) => a.id === "p2");
    expect(p1Agent.provider).toBe("gemini");
    expect(p1Agent.providerSelection.selection.requestedProvider).toBe("alias-gemini");
    expect(p2Agent.provider).toBe("gemini");
    expect(p2Agent.providerSelection.selection.requestedProvider).toBe("alias-gemini");

    // -------------------------------------------------------------
    // ACT & ASSERT: Scenario 4 - Pipeline flow
    // -------------------------------------------------------------
    selectionSpy.mockClear();
    await fs.rm(path.join(TEMP_DIR, "runs"), { recursive: true, force: true });
    const pipelineResult = await runCli([
      "run",
      path.join(TEMP_DIR, "workflows/pipeline.workflow.js"),
      "--config", configPath,
      "--out", path.join(TEMP_DIR, "runs"),
      "--cwd", TEMP_DIR,
      "--report", "json"
    ]);

    expect(pipelineResult.error).toBeNull();
    expect(selectionSpy).toHaveBeenCalledTimes(1);

    const runsPipeline = await fs.readdir(path.join(TEMP_DIR, "runs"));
    const reportPipeline = JSON.parse(await fs.readFile(path.join(TEMP_DIR, "runs", runsPipeline[0]!, "report.json"), "utf8"));
    const plAgent = reportPipeline.agents.find((a: any) => a.id === "pipeline-agent");
    expect(plAgent.provider).toBe("gemini");
    expect(plAgent.providerSelection.selection.requestedProvider).toBe("alias-gemini");

    // -------------------------------------------------------------
    // ACT & ASSERT: Scenario 5 - Loop flow
    // -------------------------------------------------------------
    selectionSpy.mockClear();
    await fs.rm(path.join(TEMP_DIR, "runs"), { recursive: true, force: true });
    const loopResult = await runCli([
      "run",
      path.join(TEMP_DIR, "workflows/loop.workflow.js"),
      "--config", configPath,
      "--out", path.join(TEMP_DIR, "runs"),
      "--cwd", TEMP_DIR,
      "--report", "json"
    ]);

    expect(loopResult.error).toBeNull();
    expect(selectionSpy).toHaveBeenCalledTimes(1);

    const runsLoop = await fs.readdir(path.join(TEMP_DIR, "runs"));
    const reportLoop = JSON.parse(await fs.readFile(path.join(TEMP_DIR, "runs", runsLoop[0]!, "report.json"), "utf8"));
    const loopAgent = reportLoop.agents.find((a: any) => a.id === "loop-agent");
    expect(loopAgent.provider).toBe("gemini");
    expect(loopAgent.providerSelection.selection.requestedProvider).toBe("alias-gemini");

    // -------------------------------------------------------------
    // ACT & ASSERT: Scenario 6 - Child workflow flow
    // -------------------------------------------------------------
    selectionSpy.mockClear();
    await fs.rm(path.join(TEMP_DIR, "runs"), { recursive: true, force: true });
    const childResult = await runCli([
      "run",
      path.join(TEMP_DIR, "workflows/child-parent.workflow.js"),
      "--config", configPath,
      "--out", path.join(TEMP_DIR, "runs"),
      "--cwd", TEMP_DIR,
      "--report", "json"
    ]);

    expect(childResult.error).toBeNull();
    expect(selectionSpy).toHaveBeenCalledTimes(1);

    const runsChild = await fs.readdir(path.join(TEMP_DIR, "runs"));
    const reportChild = JSON.parse(await fs.readFile(path.join(TEMP_DIR, "runs", runsChild[0]!, "report.json"), "utf8"));
    const childAgent = reportChild.agents.find((a: any) => a.id === "child-agent");
    expect(childAgent.provider).toBe("gemini");
    expect(childAgent.providerSelection.selection.requestedProvider).toBe("alias-gemini");

    // -------------------------------------------------------------
    // ACT & ASSERT: Scenario 7 - Null model flow
    // -------------------------------------------------------------
    selectionSpy.mockClear();
    await fs.rm(path.join(TEMP_DIR, "runs"), { recursive: true, force: true });
    const nullModelResult = await runCli([
      "run",
      path.join(TEMP_DIR, "workflows/null-model.workflow.js"),
      "--config", configPath,
      "--out", path.join(TEMP_DIR, "runs"),
      "--cwd", TEMP_DIR,
      "--report", "json"
    ]);

    expect(nullModelResult.error).toBeNull();
    expect(selectionSpy).toHaveBeenCalledTimes(1);

    const runsNullModel = await fs.readdir(path.join(TEMP_DIR, "runs"));
    const reportNull = JSON.parse(await fs.readFile(path.join(TEMP_DIR, "runs", runsNullModel[0]!, "report.json"), "utf8"));
    const nullAgent = reportNull.agents.find((a: any) => a.id === "null-model-agent");
    
    // Explicit null is retained in selection metadata, but translated to undefined in CLI args
    expect(nullAgent.providerSelection.resolvedExecution.model).toBeNull();

    const nullStderrLogPath = path.join(TEMP_DIR, "runs", runsNullModel[0]!, "agents/null-model-agent/stderr.log");
    const nullStderrLog = JSON.parse(await fs.readFile(nullStderrLogPath, "utf8"));
    const nullArgvStr = JSON.stringify(nullStderrLog.argv);
    expect(nullArgvStr).not.toContain("--model");
    expect(nullArgvStr).not.toContain("null");

    // -------------------------------------------------------------
    // ACT & ASSERT: Scenario 8 - Dry-run flow
    // -------------------------------------------------------------
    const dryRunResult = await runCli([
      "run",
      path.join(TEMP_DIR, "workflows/direct.workflow.js"),
      "--config", configPath,
      "--dry-run",
      "--cwd", TEMP_DIR
    ]);

    expect(dryRunResult.error).toBeNull();
    expect(dryRunResult.stdout).toContain("Default provider: alias-default (alias -> mock)");
    expect(dryRunResult.stdout).toContain("Alias chain: alias-default");

    // -------------------------------------------------------------
    // ACT & ASSERT: Scenario 9 - Doctor flow
    // -------------------------------------------------------------
    const doctorResult = await runCli([
      "doctor",
      "--config", configPath,
      "--cwd", TEMP_DIR,
      "--verbose"
    ]);

    expect(doctorResult.error).toBeNull();
    expect(doctorResult.stdout).toContain("Default provider alias: alias-default");
    expect(doctorResult.stdout).toContain("Concrete provider: mock");
    expect(doctorResult.stdout).toContain("Alias chain: alias-default");

    // -------------------------------------------------------------
    // ACT & ASSERT: Scenario 10 - Static validation and run validation failures
    // -------------------------------------------------------------
    // validate command rejects unknown literal
    const validateRes = await runCli([
      "validate",
      path.join(TEMP_DIR, "workflows/invalid-literal.workflow.js"),
      "--config", configPath,
      "--cwd", TEMP_DIR
    ]);

    expect(validateRes.error).toBeDefined();
    expect(exitCodeForError(validateRes.error)).toBe(3);
    expect(validateRes.error.code).toBe(ErrorCode.PROVIDER_REFERENCE_NOT_FOUND);

    // run command fails early with PROVIDER_REFERENCE_NOT_FOUND
    const runFailRes = await runCli([
      "run",
      path.join(TEMP_DIR, "workflows/invalid-literal.workflow.js"),
      "--config", configPath,
      "--out", path.join(TEMP_DIR, "runs"),
      "--cwd", TEMP_DIR
    ]);

    expect(runFailRes.error).toBeDefined();
    expect(exitCodeForError(runFailRes.error)).toBe(3);
    expect(runFailRes.error.code).toBe(ErrorCode.PROVIDER_REFERENCE_NOT_FOUND);
  });
});
