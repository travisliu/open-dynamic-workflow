import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import { main } from "../../src/cli/index.js";
import { ErrorCode } from "../../src/errors/codes.js";
import { exitCodeForError } from "../../src/errors/exit-codes.js";

const TEMP_DIR = path.resolve("tests/temp-provider-alias-runtime");

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

describe("Phase 2: Authoritative Runtime Resolution Acceptance Tests", () => {
  let configPath: string;
  let invalidConfigPath: string;

  beforeEach(async () => {
    await fs.rm(TEMP_DIR, { recursive: true, force: true });
    await fs.mkdir(TEMP_DIR, { recursive: true });
    await fs.mkdir(path.join(TEMP_DIR, "workflows"), { recursive: true });
    await fs.mkdir(path.join(TEMP_DIR, ".open-dynamic-workflow/agents"), { recursive: true });

    configPath = path.join(TEMP_DIR, "config.yaml");
    invalidConfigPath = path.join(TEMP_DIR, "invalid-config.yaml");

    const fakeProviderPath = path.resolve("tests/fixtures/providers/fake-provider-cli.mjs");

    // Write a standard config that configures providers and aliases
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

    // Write an invalid config to test PROVIDER_REFERENCE_NOT_FOUND at startup
    await fs.writeFile(invalidConfigPath, `
defaultProvider: unknown-alias-reference
providers:
  mock:
    command: mock
`);

    // Write workflows
    // 1. Direct agent call using alias
    await fs.writeFile(path.join(TEMP_DIR, "workflows/direct.workflow.js"), `
export const meta = { name: "direct-flow", description: "Direct agent alias call" };
export default async () => {
  const res = await agent({
    id: "my-agent",
    prompt: "hello from direct flow",
    provider: "alias-gemini"
  });
  return { res };
};
`);

    // 2. Shared agent definition and workflow
    await fs.writeFile(path.join(TEMP_DIR, ".open-dynamic-workflow/agents/custom.agent.js"), `
export default defineAgent({
  id: "custom-agent",
  description: "Custom agent call",
  inputSchema: { type: "object" },
  run: async (context, runtime) => {
    return await runtime.agent({
      id: "inner-agent",
      prompt: "shared prompt",
      provider: "alias-gemini"
    });
  }
});
`);

    await fs.writeFile(path.join(TEMP_DIR, "workflows/shared.workflow.js"), `
export const meta = { name: "shared-flow", description: "Shared agent alias call" };
export default async () => {
  const res = await agent({
    definition: "custom-agent"
  });
  return { res };
};
`);

    // 3. Parallel agent calls using aliases
    await fs.writeFile(path.join(TEMP_DIR, "workflows/parallel.workflow.js"), `
export const meta = { name: "parallel-flow", description: "Parallel agent alias calls" };
export default async () => {
  const res = await parallel([
    async () => await agent({ id: "p1", prompt: "p1 prompt", provider: "alias-gemini" }),
    async () => await agent({ id: "p2", prompt: "p2 prompt", provider: "alias-gemini" })
  ]);
  return { res };
};
`);

    // 4. Pipeline agent call using alias
    await fs.writeFile(path.join(TEMP_DIR, "workflows/pipeline.workflow.js"), `
export const meta = { name: "pipeline-flow", description: "Pipeline agent alias calls" };
export default async () => {
  const res = await pipeline(["item1"], [
    {
      name: "stage1",
      run: async (item, ctx) => {
        return await ctx.agent({
          id: "pipeline-agent",
          prompt: "pipeline prompt: " + item,
          provider: "alias-gemini"
        });
      }
    }
  ]);
  return { res };
};
`);

    // 5. Loop agent call using alias
    await fs.writeFile(path.join(TEMP_DIR, "workflows/loop.workflow.js"), `
export const meta = { name: "loop-flow", description: "Loop agent alias calls" };
export default async () => {
  const res = await loop({
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
  return { res };
};
`);

    // 6. Child parent & child sub workflows
    await fs.writeFile(path.join(TEMP_DIR, "workflows/child-sub.workflow.js"), `
export const meta = { name: "child-sub", description: "Child sub workflow" };
export default async () => {
  return await agent({
    id: "child-agent",
    prompt: "child prompt",
    provider: "alias-gemini"
  });
};
`);

    await fs.writeFile(path.join(TEMP_DIR, "workflows/child-parent.workflow.js"), `
export const meta = { name: "child-parent", description: "Parent workflow" };
export default async () => {
  const res = await workflow({
    name: "child-sub"
  });
  return { res };
};
`);

    // 7. Workflow with null model
    await fs.writeFile(path.join(TEMP_DIR, "workflows/null-model.workflow.js"), `
export const meta = { name: "null-model-flow", description: "Null model agent alias call" };
export default async () => {
  const res = await agent({
    id: "null-model-agent",
    prompt: "null model prompt",
    provider: "alias-null-model"
  });
  return { res };
};
`);

    // 8. Workflow with unknown literal provider reference
    await fs.writeFile(path.join(TEMP_DIR, "workflows/invalid-literal.workflow.js"), `
export const meta = { name: "invalid-literal-flow", description: "Invalid literal provider reference" };
export default async () => {
  const res = await agent({
    id: "invalid-agent",
    prompt: "invalid prompt",
    provider: "unknown-literal-alias"
  });
  return { res };
};
`);
  });

  afterEach(async () => {
    await fs.rm(TEMP_DIR, { recursive: true, force: true });
  });

  it("exercises direct, shared, parallel, pipeline, loop, child, and null-model flows using provider aliases", async () => {
    // -------------------------------------------------------------
    // Scenario 1: Direct agent call using alias-gemini
    // -------------------------------------------------------------
    const directResult = await runCli([
      "run",
      path.join(TEMP_DIR, "workflows/direct.workflow.js"),
      "--config", configPath,
      "--out", path.join(TEMP_DIR, "runs"),
      "--cwd", TEMP_DIR,
      "--report", "json"
    ]);

    expect(directResult.error).toBeNull();

    // Verify report.json selection metadata
    const runs = await fs.readdir(path.join(TEMP_DIR, "runs"));
    const runId = runs[0]!;
    const reportPath = path.join(TEMP_DIR, "runs", runId, "report.json");
    const report = JSON.parse(await fs.readFile(reportPath, "utf8"));

    const agentRes = report.agents.find((a: any) => a.id === "my-agent");
    expect(agentRes).toBeDefined();
    expect(agentRes.ok).toBe(true);
    expect(agentRes.provider).toBe("gemini"); // downstream is concrete provider
    expect(agentRes.model).toBe("gemini-alias-model"); // alias model wins

    // Assert providerSelection metadata is preserved
    expect(agentRes.providerSelection).toBeDefined();
    expect(agentRes.providerSelection.selection.requestedProvider).toBe("alias-gemini");
    expect(agentRes.providerSelection.selection.resolvedProvider).toBe("gemini");
    expect(agentRes.providerSelection.selection.providerAlias).toBe("alias-gemini");
    expect(agentRes.providerSelection.resolvedExecution.model).toBe("gemini-alias-model");

    // Verify downstream received only concrete provider
    const stderrLogPath = path.join(TEMP_DIR, "runs", runId, "agents/my-agent/stderr.log");
    const stderrLog = JSON.parse(await fs.readFile(stderrLogPath, "utf8"));
    // Verify that the argv doesn't contain the alias name, but contains concrete arguments
    const argvStr = JSON.stringify(stderrLog.argv);
    expect(argvStr).not.toContain("alias-gemini");
    expect(argvStr).toContain("--model");
    expect(argvStr).toContain("gemini-alias-model");

    // -------------------------------------------------------------
    // Scenario 2: Shared agent call using alias-gemini
    // -------------------------------------------------------------
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
    const runsShared = await fs.readdir(path.join(TEMP_DIR, "runs"));
    const reportShared = JSON.parse(await fs.readFile(path.join(TEMP_DIR, "runs", runsShared[0]!, "report.json"), "utf8"));
    const innerAgentRes = reportShared.agents.find((a: any) => a.id === "inner-agent");
    expect(innerAgentRes).toBeDefined();
    expect(innerAgentRes.ok).toBe(true);
    expect(innerAgentRes.provider).toBe("gemini");
    expect(innerAgentRes.providerSelection.selection.requestedProvider).toBe("alias-gemini");

    // -------------------------------------------------------------
    // Scenario 3: Parallel agent calls using aliases
    // -------------------------------------------------------------
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
    const runsParallel = await fs.readdir(path.join(TEMP_DIR, "runs"));
    const reportParallel = JSON.parse(await fs.readFile(path.join(TEMP_DIR, "runs", runsParallel[0]!, "report.json"), "utf8"));
    const p1 = reportParallel.agents.find((a: any) => a.id === "p1");
    const p2 = reportParallel.agents.find((a: any) => a.id === "p2");
    expect(p1.providerSelection.selection.requestedProvider).toBe("alias-gemini");
    expect(p2.providerSelection.selection.requestedProvider).toBe("alias-gemini");

    // -------------------------------------------------------------
    // Scenario 4: Pipeline agent call
    // -------------------------------------------------------------
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
    const runsPipeline = await fs.readdir(path.join(TEMP_DIR, "runs"));
    const reportPipeline = JSON.parse(await fs.readFile(path.join(TEMP_DIR, "runs", runsPipeline[0]!, "report.json"), "utf8"));
    const plAgent = reportPipeline.agents.find((a: any) => a.id === "pipeline-agent");
    expect(plAgent.providerSelection.selection.requestedProvider).toBe("alias-gemini");

    // -------------------------------------------------------------
    // Scenario 5: Loop agent call
    // -------------------------------------------------------------
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
    const runsLoop = await fs.readdir(path.join(TEMP_DIR, "runs"));
    const reportLoop = JSON.parse(await fs.readFile(path.join(TEMP_DIR, "runs", runsLoop[0]!, "report.json"), "utf8"));
    const loopAgent = reportLoop.agents.find((a: any) => a.id === "loop-agent");
    expect(loopAgent.providerSelection.selection.requestedProvider).toBe("alias-gemini");

    // -------------------------------------------------------------
    // Scenario 6: Child workflow call
    // -------------------------------------------------------------
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
    const runsChild = await fs.readdir(path.join(TEMP_DIR, "runs"));
    const reportChild = JSON.parse(await fs.readFile(path.join(TEMP_DIR, "runs", runsChild[0]!, "report.json"), "utf8"));
    const childAgent = reportChild.agents.find((a: any) => a.id === "child-agent");
    expect(childAgent.providerSelection.selection.requestedProvider).toBe("alias-gemini");

    // -------------------------------------------------------------
    // Scenario 7: Null model agent call
    // -------------------------------------------------------------
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
    const runsNullModel = await fs.readdir(path.join(TEMP_DIR, "runs"));
    const reportNull = JSON.parse(await fs.readFile(path.join(TEMP_DIR, "runs", runsNullModel[0]!, "report.json"), "utf8"));
    const nullAgent = reportNull.agents.find((a: any) => a.id === "null-model-agent");
    expect(nullAgent.providerSelection.resolvedExecution.model).toBeNull();

    // Verify model argument was omitted in the downstream CLI execution
    const nullStderrLogPath = path.join(TEMP_DIR, "runs", runsNullModel[0]!, "agents/null-model-agent/stderr.log");
    const nullStderrLog = JSON.parse(await fs.readFile(nullStderrLogPath, "utf8"));
    const nullArgvStr = JSON.stringify(nullStderrLog.argv);
    expect(nullArgvStr).not.toContain("--model");
    expect(nullArgvStr).not.toContain("null");
  });

  it("validates that unknown literal provider references fail static validation and run", async () => {
    // -------------------------------------------------------------
    // Scenario 8: Static validation fails with PROVIDER_REFERENCE_NOT_FOUND
    // -------------------------------------------------------------
    const validateRes = await runCli([
      "validate",
      path.join(TEMP_DIR, "workflows/invalid-literal.workflow.js"),
      "--config", configPath,
      "--cwd", TEMP_DIR
    ]);

    expect(validateRes.error).toBeDefined();
    expect(exitCodeForError(validateRes.error)).toBe(3);
    expect(validateRes.error.code).toBe(ErrorCode.PROVIDER_REFERENCE_NOT_FOUND);

    // Run also fails early before execution with PROVIDER_REFERENCE_NOT_FOUND
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

  it("verifies dry-run, doctor, and startup error handling of provider aliases", async () => {
    // -------------------------------------------------------------
    // Scenario 9: Dry run with aliased default provider
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
    // Scenario 10: Doctor resolves aliased default provider
    // -------------------------------------------------------------
    const doctorResult = await runCli([
      "doctor",
      "--config", configPath,
      "--cwd", TEMP_DIR,
      "--verbose"
    ]);

    expect(doctorResult.error).toBeNull();
    // Default defaultProvider is alias-default which resolves to mock
    expect(doctorResult.stdout).toContain("Default provider alias: alias-default");
    expect(doctorResult.stdout).toContain("Concrete provider: mock");
    expect(doctorResult.stdout).toContain("Alias chain: alias-default");

    // -------------------------------------------------------------
    // Scenario 11: Doctor with unknown defaultProvider fails
    // -------------------------------------------------------------
    const doctorFailResult = await runCli([
      "doctor",
      "--config", invalidConfigPath,
      "--cwd", TEMP_DIR
    ]);

    expect(doctorFailResult.error).toBeDefined();
    expect(exitCodeForError(doctorFailResult.error)).toBe(3);
    expect(doctorFailResult.error.code).toBe(ErrorCode.PROVIDER_REFERENCE_NOT_FOUND);
  });
});
