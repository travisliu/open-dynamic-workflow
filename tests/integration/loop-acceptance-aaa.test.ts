import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import { main } from "../../src/cli/index.js";
import { exitCodeForError } from "../../src/errors/exit-codes.js";

const TEMP_DIR = path.resolve("tests/temp-loop-acceptance-aaa");

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
  let exitCode: number | undefined;

  // Mock process.exit
  const exitSpy = vi.spyOn(process, "exit").mockImplementation((code) => {
    exitCode = code as number;
    throw new Error(`Process.exit(${code})`);
  });

  try {
    await main(["node", "open-dynamic-workflow", ...args]);
  } catch (err: any) {
    if (err.message.startsWith("Process.exit")) {
      // expected from mock
    } else {
      error = err;
      exitCode = exitCodeForError(err);
      console.error(err.message);
    }
  } finally {
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
    logSpy.mockRestore();
    errorSpy.mockRestore();
    exitSpy.mockRestore();
  }

  if (exitCode === undefined) {
    exitCode = 0;
  }

  return {
    stdout: stdoutData.join(""),
    stderr: stderrData.join(""),
    error,
    exitCode
  };
}

describe("Loop Acceptance (AAA)", () => {
  const configPath = path.resolve("tests/fixtures/config/loop-integration.config.yaml");

  beforeEach(async () => {
    await fs.rm(TEMP_DIR, { recursive: true, force: true });
    await fs.mkdir(TEMP_DIR, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(TEMP_DIR, { recursive: true, force: true });
  });

  it("verifies throw-mode success returning final state directly", async () => {
    // Arrange
    const workflowPath = path.resolve("tests/fixtures/workflows/loop-break.workflow.js");

    // Act
    const result = await runCli([
      "run",
      workflowPath,
      "--config", configPath,
      "--out", TEMP_DIR,
      "--report", "json"
    ]);

    // Assert
    expect(result.exitCode).toBe(0);
    expect(result.error).toBeNull();
    const parsed = JSON.parse(result.stdout);
    expect(parsed.status).toBe("succeeded");
    
    // Result contains the final nextState directly
    expect(parsed.result).toEqual({ count: 2 });
    
    expect(parsed.loops).toBeDefined();
    expect(parsed.loops[0].status).toBe("succeeded");
    expect(parsed.loops[0].roundsCompleted).toBe(2);

    // Check artifacts
    const runs = await fs.readdir(TEMP_DIR);
    const runDir = path.join(TEMP_DIR, runs[0]!);
    const loopDir = path.join(runDir, "loops", "loop-break");
    
    expect(await fs.stat(path.join(loopDir, "loop.json"))).toBeDefined();
    expect(await fs.stat(path.join(loopDir, "initial-state.json"))).toBeDefined();
    expect(await fs.stat(path.join(loopDir, "final-state.json"))).toBeDefined();
    expect(await fs.stat(path.join(loopDir, "result.json"))).toBeDefined();
    expect(await fs.stat(path.join(loopDir, "rounds/0001/input-state.json"))).toBeDefined();
    expect(await fs.stat(path.join(loopDir, "rounds/0001/run-result.json"))).toBeDefined();
    expect(await fs.stat(path.join(loopDir, "rounds/0001/next-state.json"))).toBeDefined();

    // Verify history.json and round.json are NOT written
    await expect(fs.stat(path.join(loopDir, "history.json"))).rejects.toThrow();
    await expect(fs.stat(path.join(loopDir, "rounds/0001/round.json"))).rejects.toThrow();

    const loopMeta = JSON.parse(await fs.readFile(path.join(loopDir, "loop.json"), "utf8"));
    expect(loopMeta.options.maxRounds).toBe(5);
    
    const resultJson = JSON.parse(await fs.readFile(path.join(loopDir, "result.json"), "utf8"));
    expect(resultJson.status).toBe("succeeded");
  });

  it("verifies settled-mode success returning structured envelope", async () => {
    // Arrange
    const workflowPath = path.resolve("tests/fixtures/workflows/loop-settled-success.workflow.js");

    // Act
    const result = await runCli([
      "run",
      workflowPath,
      "--config", configPath,
      "--out", TEMP_DIR,
      "--report", "json"
    ]);

    // Assert
    expect(result.exitCode).toBe(0);
    expect(result.error).toBeNull();
    const parsed = JSON.parse(result.stdout);
    expect(parsed.status).toBe("succeeded");
    
    // Settled-mode success return value
    expect(parsed.result).toEqual({
      ok: true,
      status: "succeeded",
      label: "settled-success-loop",
      loopId: "settled-success-loop",
      roundsCompleted: 2,
      finalState: { count: 2 },
      artifacts: {
        dir: "loops/settled-success-loop"
      }
    });
  });

  it("verifies maxRounds terminal behavior failing by default", async () => {
    // Arrange
    const workflowPath = path.resolve("tests/fixtures/workflows/loop-max-rounds.workflow.js");

    // Act
    const result = await runCli([
      "run",
      workflowPath,
      "--config", configPath,
      "--out", TEMP_DIR,
      "--report", "json"
    ]);

    // Assert
    expect(result.exitCode).toBe(1);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.status).toBe("failed");
    expect(parsed.loops[0].status).toBe("max_rounds");
    expect(parsed.loops[0].roundsCompleted).toBe(2);

    const runs = await fs.readdir(TEMP_DIR);
    const runDir = path.join(TEMP_DIR, runs[0]!);
    const loopDir = path.join(runDir, "loops", "loop-max-rounds");
    expect(await fs.stat(path.join(loopDir, "error.json"))).toBeDefined();
  });

  it("verifies settled max rounds returning ok: false, status: max_rounds", async () => {
    // Arrange
    const workflowPath = path.resolve("tests/fixtures/workflows/loop-settled-max-rounds.workflow.js");

    // Act
    const result = await runCli([
      "run",
      workflowPath,
      "--config", configPath,
      "--out", TEMP_DIR,
      "--report", "json"
    ]);

    // Assert
    expect(result.exitCode).toBe(0);
    expect(result.error).toBeNull();
    const parsed = JSON.parse(result.stdout);
    expect(parsed.status).toBe("succeeded");
    expect(parsed.result).toEqual({
      ok: false,
      status: "max_rounds",
      label: "settled-max-rounds-loop",
      loopId: "settled-max-rounds-loop",
      roundsCompleted: 2,
      finalState: { count: 2 },
      error: expect.any(Object),
      artifacts: {
        dir: "loops/settled-max-rounds-loop"
      }
    });
  });

  it("verifies failureMode: settled round error", async () => {
    // Arrange
    const workflowPath = path.resolve("tests/fixtures/workflows/loop-failure-settled.workflow.js");

    // Act
    const result = await runCli([
      "run",
      workflowPath,
      "--config", configPath,
      "--out", TEMP_DIR,
      "--report", "json"
    ]);

    // Assert
    expect(result.exitCode).toBe(0);
    expect(result.error).toBeNull();
    const parsed = JSON.parse(result.stdout);
    expect(parsed.status).toBe("succeeded");
    expect(parsed.loops[0].status).toBe("failed");
    expect(parsed.loops[0].roundsCompleted).toBe(1);
    expect(parsed.result).toEqual({
      ok: false,
      status: "failed",
      label: "loop-failure-settled",
      loopId: "loop-failure-settled",
      roundsCompleted: 1,
      finalState: { count: 0 },
      error: expect.any(Object),
      artifacts: {
        dir: "loops/loop-failure-settled"
      }
    });
  });

  it("verifies forbidden tool() usage inside loop round", async () => {
    // Arrange
    const workflowPath = path.resolve("tests/fixtures/workflows/invalid-loop-tool.js");

    // Act
    const result = await runCli([
      "validate",
      workflowPath,
      "--config", configPath
    ]);

    // Assert
    expect(result.exitCode).toBe(3);
    expect(result.stderr).toContain("tool() is not allowed");
  });

  it("verifies forbidden maxRounds exceeds ceiling validation", async () => {
    // Arrange
    const workflowPath = path.resolve("tests/fixtures/workflows/invalid-loop-max-rounds.workflow.js");

    // Act
    const result = await runCli([
      "validate",
      workflowPath,
      "--config", configPath
    ]);

    // Assert
    expect(result.exitCode).toBe(3);
    expect(result.stderr).toContain("maxRounds");
    expect(result.stderr).toContain("exceeds the configured ceiling of 20");
  });

  it("verifies allowed ctx.agent(), ctx.workflow(), and global parallel() inside loop", async () => {
    // Arrange
    const workflowPath = path.resolve("tests/fixtures/workflows/loop-nested-parallel.workflow.js");

    // Act
    const result = await runCli([
      "run",
      workflowPath,
      "--config", configPath,
      "--out", TEMP_DIR,
      "--report", "json"
    ]);

    // Assert
    expect(result.exitCode).toBe(0);
    expect(result.error).toBeNull();
    const parsed = JSON.parse(result.stdout);
    expect(parsed.status).toBe("succeeded");
    
    // Verify nested artifacts
    const runs = await fs.readdir(TEMP_DIR);
    const runDir = path.join(TEMP_DIR, runs[0]!);
    const roundDir = path.join(runDir, "loops/nested-parallel-loop/rounds/0001");
    expect(await fs.stat(path.join(roundDir, "input-state.json"))).toBeDefined();
    expect(await fs.stat(path.join(roundDir, "run-result.json"))).toBeDefined();
    expect(await fs.stat(path.join(roundDir, "next-state.json"))).toBeDefined();
  });

  it("verifies loop inside parallel task thunks is banned", async () => {
    // Arrange
    const workflowPath = path.resolve("tests/fixtures/workflows/loop-inside-parallel.workflow.js");

    // Act
    const result = await runCli([
      "run",
      workflowPath,
      "--config", configPath,
      "--out", TEMP_DIR,
      "--report", "json"
    ]);

    // Assert
    expect(result.exitCode).toBe(3);
    expect(result.stderr).toContain("loop() inside parallel() is not supported to prevent state overwrites.");
  });

  it("verifies nested workflow() call is allowed", async () => {
    // Arrange
    const workflowPath = path.resolve("tests/fixtures/workflows/loop-nested-workflow.workflow.js");

    // Act
    const result = await runCli([
      "run",
      workflowPath,
      "--config", configPath,
      "--out", TEMP_DIR,
      "--report", "json"
    ]);

    // Assert
    expect(result.exitCode).toBe(0);
    expect(result.error).toBeNull();
    const parsed = JSON.parse(result.stdout);
    expect(parsed.status).toBe("succeeded");

    const runs = await fs.readdir(TEMP_DIR);
    const runDir = path.join(TEMP_DIR, runs[0]!);

    const nestedCalls = JSON.parse(
      await fs.readFile(path.join(runDir, "loops/nested-workflow-loop/rounds/0001/nested-calls.json"), "utf8")
    );
    expect(nestedCalls.workflows).toHaveLength(1);
    const wfId = nestedCalls.workflows[0];
    expect(wfId).toBeDefined();

    expect(await fs.stat(path.join(runDir, "workflows", wfId, "input.json"))).toBeDefined();
    expect(await fs.stat(path.join(runDir, "workflows", wfId, "result.json"))).toBeDefined();
  });

  it("verifies compact event payloads in JSONL", async () => {
    // Arrange
    const workflowPath = path.resolve("tests/fixtures/workflows/loop-break.workflow.js");

    // Act
    const result = await runCli([
      "run",
      workflowPath,
      "--config", configPath,
      "--out", TEMP_DIR,
      "--report", "jsonl"
    ]);

    // Assert
    expect(result.exitCode).toBe(0);
    const lines = result.stdout.split("\n").filter(l => l.trim());
    const events = lines.map(l => JSON.parse(l));
    
    // Verify monotonic sequence numbers
    let prevSeq = -1;
    for (const event of events) {
      expect(event.sequence).toBeDefined();
      expect(event.sequence).toBeGreaterThan(prevSeq);
      prevSeq = event.sequence;
    }

    const loopStarted = events.find(e => e.type === "loop.started");
    expect(loopStarted.payload.loopId).toBe("loop-break");

    const roundCompleted = events.find(e => e.type === "loop.round.completed");
    expect(roundCompleted.payload.roundIndex).toBe(0);
    expect(roundCompleted.payload.historyEntry).toBeUndefined();

    const loopCompleted = events.find(e => e.type === "loop.completed");
    expect(loopCompleted.payload.loopId).toBe("loop-break");
    expect(loopCompleted.payload.statePreview).toBeDefined();
    expect(loopCompleted.payload.finalState).toBeUndefined();
  });

  it("verifies pretty report correctly summarizes loop execution", async () => {
    // Arrange
    const workflowPath = path.resolve("tests/fixtures/workflows/loop-break.workflow.js");

    // Act
    const result = await runCli([
      "run",
      workflowPath,
      "--config", configPath,
      "--out", TEMP_DIR,
      "--report", "pretty"
    ]);

    // Assert
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("loop loop-break");
    expect(result.stdout).toContain("2/5 rounds");
    expect(result.stdout).not.toContain("accepted");
    expect(result.stdout).toContain("loops:     1 succeeded");
  });

  it("verifies loop with unsafe initial state behaves correctly in throw mode", async () => {
    // Arrange
    const workflowPath = path.join(TEMP_DIR, "loop-unsafe-initial-state.workflow.js");
    const workflowContent = `
export const meta = {
  name: "loop-unsafe-initial-state",
  description: "Test loop with non-JSON-safe initialState"
};

const cyclicState = {};
cyclicState.self = cyclicState;

const result = await loop({
  label: "unsafe-initial-state-loop",
  initialState: cyclicState,
  options: { maxRounds: 5, failureMode: "throw" },
  run: async (state, ctx) => {
    return {
      done: true,
      nextState: state
    };
  }
});

export default result;
`;
    await fs.writeFile(workflowPath, workflowContent, "utf8");

    // Act
    const result = await runCli([
      "run",
      workflowPath,
      "--config", configPath,
      "--out", TEMP_DIR,
      "--report", "json"
    ]);

    // Assert
    expect(result.exitCode).toBe(3);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.status).toBe("failed");
    expect(parsed.loops).toBeDefined();
    expect(parsed.loops.length).toBe(1);

    const loopSummary = parsed.loops[0];
    expect(loopSummary.status).toBe("failed");
    expect(loopSummary.roundsCompleted).toBe(0);

    const runs = await fs.readdir(TEMP_DIR);
    let runDir = "";
    for (const name of runs) {
      const fullPath = path.join(TEMP_DIR, name);
      const stat = await fs.stat(fullPath);
      if (stat.isDirectory()) {
        runDir = fullPath;
        break;
      }
    }
    expect(runDir).not.toBe("");
    const loopDir = path.join(runDir, "loops", "unsafe-initial-state-loop");

    expect(await fs.stat(path.join(loopDir, "loop.json"))).toBeDefined();
    expect(await fs.stat(path.join(loopDir, "error.json"))).toBeDefined();
    expect(await fs.stat(path.join(loopDir, "result.json"))).toBeDefined();

    // initialState.json should not exist
    await expect(fs.stat(path.join(loopDir, "initial-state.json"))).rejects.toThrow();
  });

  it("verifies loop with unsafe initial state in settled mode still fails immediately", async () => {
    // Arrange
    const workflowPath = path.join(TEMP_DIR, "loop-unsafe-initial-state-settled.workflow.js");
    const workflowContent = `
export const meta = {
  name: "loop-unsafe-initial-state-settled",
  description: "Test loop with non-JSON-safe initialState in settled mode"
};

const cyclicState = {};
cyclicState.self = cyclicState;

const result = await loop({
  label: "unsafe-initial-state-settled-loop",
  initialState: cyclicState,
  options: { maxRounds: 5, failureMode: "settled" },
  run: async (state, ctx) => {
    return {
      done: true,
      nextState: state
    };
  }
});

export default result;
`;
    await fs.writeFile(workflowPath, workflowContent, "utf8");

    // Act
    const result = await runCli([
      "run",
      workflowPath,
      "--config", configPath,
      "--out", TEMP_DIR,
      "--report", "json"
    ]);

    // Assert
    expect(result.exitCode).toBe(3);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.status).toBe("failed");
    expect(parsed.loops).toBeDefined();
    expect(parsed.loops.length).toBe(1);

    const loopSummary = parsed.loops[0];
    expect(loopSummary.status).toBe("failed");
    expect(loopSummary.roundsCompleted).toBe(0);

    const runs = await fs.readdir(TEMP_DIR);
    let runDir = "";
    for (const name of runs) {
      const fullPath = path.join(TEMP_DIR, name);
      const stat = await fs.stat(fullPath);
      if (stat.isDirectory()) {
        runDir = fullPath;
        break;
      }
    }
    expect(runDir).not.toBe("");
    const loopDir = path.join(runDir, "loops", "unsafe-initial-state-settled-loop");

    expect(await fs.stat(path.join(loopDir, "loop.json"))).toBeDefined();
    expect(await fs.stat(path.join(loopDir, "error.json"))).toBeDefined();
    expect(await fs.stat(path.join(loopDir, "result.json"))).toBeDefined();

    // initialState.json should not exist
    await expect(fs.stat(path.join(loopDir, "initial-state.json"))).rejects.toThrow();
  });

  it("verifies loop child workflow ID collision prevention is banned (duplicate labels)", async () => {
    // Arrange
    const workflowPath = path.resolve("tests/fixtures/workflows/loop-duplicate-labels.workflow.js");

    // Act
    const result = await runCli([
      "run",
      workflowPath,
      "--config", configPath,
      "--out", TEMP_DIR,
      "--report", "json"
    ]);

    // Assert
    expect(result.exitCode).toBe(3);
    expect(result.stderr).toContain("Duplicate loop label detected: 'duplicate-loop'. All loop labels in a workflow must be unique.");
  });

  it("verifies child workflow tool scope from loop rounds", async () => {
    const toolsDir = path.resolve(".open-dynamic-workflow/tools");
    const childWfPath = path.resolve("tests/fixtures/workflows/loop-tool-child.workflow.js");
    const parentWfPath = path.resolve("tests/fixtures/workflows/loop-tool-parent.workflow.js");
    const toolEchoPath = path.join(toolsDir, "echo.ts");

    await fs.mkdir(toolsDir, { recursive: true });

    // 2. Create the real tool echo
    const srcToolsPath = path.resolve("src/tools/index.ts");
    await fs.writeFile(toolEchoPath, `
      import { defineTool } from "${srcToolsPath}";
      export default defineTool({
        id: "echo",
        description: "echo tool",
        inputSchema: { type: "object", properties: { msg: { type: "string" } } },
        run: (input) => ({ reply: input.msg })
      });
    `);

    // 3. Create child workflow
    await fs.writeFile(childWfPath, `
      export const meta = { name: "loop-tool-child", description: "child desc" };
      export default async (ctx) => {
        return await ctx.tool({ definition: "echo", args: { msg: "from-child" } });
      };
    `);

    // 4. Create parent workflow
    await fs.writeFile(parentWfPath, `
      export const meta = { name: "loop-tool-parent", description: "parent desc" };
      const result = await loop({
        label: "child-tool-loop",
        initialState: {},
        options: { maxRounds: 1 },
        run: async (state, ctx) => {
          const child = await ctx.workflow({ name: "loop-tool-child" });
          return { done: true, nextState: { child } };
        }
      });
      export default result;
    `);

    // 5. Run the CLI
    const result = await runCli([
      "run",
      parentWfPath,
      "--config", configPath,
      "--out", TEMP_DIR,
      "--report", "json"
    ]);

    try {
      if (result.exitCode !== 0) {
        console.log("TEST RUN STDERR:", result.stderr);
      }
      expect(result.exitCode).toBe(0);
      expect(result.error).toBeNull();
      const parsed = JSON.parse(result.stdout);
      expect(parsed.status).toBe("succeeded");
      expect(parsed.result).toEqual({ child: { reply: "from-child" } });

      expect(parsed.tools).toBeDefined();
      const toolSummaries = parsed.tools.filter((t: any) => t.definitionId === "echo");
      expect(toolSummaries).toHaveLength(1);
      expect(toolSummaries[0].status).toBe("succeeded");

      const childSummaries = parsed.workflows.filter((w: any) => w.workflowName === "loop-tool-child");
      expect(childSummaries).toHaveLength(1);

      const runs = await fs.readdir(TEMP_DIR);
      const runDir = path.join(TEMP_DIR, runs[0]!);
      const nestedCalls = JSON.parse(
        await fs.readFile(path.join(runDir, "loops/child-tool-loop/rounds/0001/nested-calls.json"), "utf8")
      );
      expect(nestedCalls.workflows).toHaveLength(1);
    } finally {
      await fs.rm(toolEchoPath, { force: true });
      await fs.rm(childWfPath, { force: true });
      await fs.rm(parentWfPath, { force: true });
    }
  });

  it("verifies explicit agent ID contract in loop rounds", async () => {
    // Arrange
    const workflowPath = path.resolve("tests/fixtures/workflows/loop-explicit-agent-id.workflow.js");

    // Act
    const result = await runCli([
      "run",
      workflowPath,
      "--config", configPath,
      "--out", TEMP_DIR,
      "--report", "json"
    ]);

    // Assert
    expect(result.exitCode).toBe(0);
    expect(result.error).toBeNull();
    const parsed = JSON.parse(result.stdout);
    expect(parsed.status).toBe("succeeded");

    // Assert report agent IDs are exactly as expected
    const agentIds = parsed.agents.map((a: any) => a.id);
    expect(agentIds).toContain("my-agent");
    expect(agentIds).toContain("explicit-agent-loop:round-1:review");
    expect(agentIds).not.toContain("explicit-agent-loop:round-1:my-agent");

    const runs = await fs.readdir(TEMP_DIR);
    const runDir = path.join(TEMP_DIR, runs[0]!);

    // Assert nested-calls.json contains exactly those same IDs
    const nestedCalls = JSON.parse(
      await fs.readFile(path.join(runDir, "loops/explicit-agent-loop/rounds/0001/nested-calls.json"), "utf8")
    );
    expect(nestedCalls.agents).toContain("my-agent");
    expect(nestedCalls.agents).toContain("explicit-agent-loop:round-1:review");
    expect(nestedCalls.agents).not.toContain("explicit-agent-loop:round-1:my-agent");

    // Assert matching agent artifact directories exist
    expect(await fs.stat(path.join(runDir, "agents/my-agent"))).toBeDefined();
    expect(await fs.stat(path.join(runDir, "agents/explicit-agent-loop:round-1:review"))).toBeDefined();
    await expect(fs.stat(path.join(runDir, "agents/explicit-agent-loop:round-1:my-agent"))).rejects.toThrow();
  });
});
