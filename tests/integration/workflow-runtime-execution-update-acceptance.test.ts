import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { main } from "../../src/cli/index.js";
import { DefaultRuntimeRunner } from "../../src/workflow/runtime.js";
import { validateWorkflow } from "../../src/workflow/validate.js";
import type { ParsedWorkflow } from "../../src/workflow/types.js";
import type { CliRunOptions, ResolvedConfig } from "../../src/types/config.js";
import type { AgentExecutor, AgentExecutionInput } from "../../src/agents/execution-types.js";
import type { AgentResult } from "../../src/types/agent.js";
import type { RuntimeEventSink } from "../../src/orchestration/scheduler.js";

const TEMP_DIR = path.resolve("tests/temp-workflow-runtime-execution-update-acceptance");

class FakeAgentExecutor implements AgentExecutor {
  async execute(input: AgentExecutionInput): Promise<AgentResult> {
    throw new Error(`Agent executor should not run in workflow runtime acceptance tests: ${input.id}`);
  }
}

class FakeEventSink implements RuntimeEventSink {
  emit() {
    // No-op for context-only acceptance coverage.
  }
}

const mockClock = {
  now() {
    return new Date("2026-07-09T00:00:00.000Z");
  }
};

const mockIdGenerator = {
  nextId(prefix: string) {
    return `${prefix}-mock-1`;
  }
};

const defaultCliOptions: CliRunOptions = {
  workflowFile: "workflow.js",
  args: {},
  concurrency: 2,
  dryRun: false,
  failFast: false,
  verbose: false
};

const defaultResolvedConfig: ResolvedConfig = {
  defaultProvider: "mock",
  concurrency: 2,
  timeoutMs: 30000,
  providers: {},
  security: {
    allowWorkflowImports: false,
    passEnv: [],
    redactEnv: []
  },
  reporting: {
    mode: "pretty",
    verbose: false
  },
  cwd: "/workspace",
  outDir: "/workspace/.open-dynamic-workflow/runs"
};

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

function createParsedWorkflow(body: string, name: string): ParsedWorkflow {
  return {
    meta: { name, description: `${name} acceptance workflow` },
    body,
    sourcePath: `${name}.workflow.js`,
    sourceText: body,
    sourceHash: `${name}-hash`
  };
}

describe("Workflow Runtime Execution Update Acceptance", () => {
  beforeEach(async () => {
    await fs.rm(TEMP_DIR, { recursive: true, force: true });
    await fs.mkdir(TEMP_DIR, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(TEMP_DIR, { recursive: true, force: true });
  });

  it("default-exported workflow functions receive zero callback arguments and share the global context binding", async () => {
    // Arrange
    const runner = new DefaultRuntimeRunner();
    const parsedWorkflow = createParsedWorkflow(
      `
        context.set("shared.message", "from-top-level");
        context.append("shared.events", "top-level");

        export default async (...receivedArgs) => {
          context.append("shared.events", "default-export");
          return {
            argCount: receivedArgs.length,
            message: context.get("shared.message"),
            events: context.get("shared.events")
          };
        };
      `,
      "default-export-global-context"
    );

    // Act
    const result = await runner.run(
      { run: { runId: "test-run", runDir: "/tmp/test-run" },
        parsedWorkflow, config: defaultResolvedConfig, cli: defaultCliOptions },
      { agentExecutor: new FakeAgentExecutor(), eventSink: new FakeEventSink(), clock: mockClock, idGenerator: mockIdGenerator }
    );

    // Assert
    expect(result.status).toBe("succeeded");
    expect(result.result).toEqual({
      argCount: 0,
      message: "from-top-level",
      events: ["top-level", "default-export"]
    });
  });

  it("parent and child workflows share the same active run-scoped global context store", async () => {
    // Arrange
    const configPath = path.join(TEMP_DIR, "workflow.config.json");
    const childPath = path.join(TEMP_DIR, "context-child.workflow.js");
    const parentPath = path.join(TEMP_DIR, "context-parent.workflow.js");

    await fs.writeFile(
      configPath,
      JSON.stringify({
        workflow: {
          discovery: {
            include: ["*.workflow.js"]
          }
        }
      })
    );

    await fs.writeFile(
      childPath,
      `
export const meta = { name: "context-child", description: "child context writer" };
export default async () => {
  const before = context.get("shared.parentValue");
  context.set("shared.childSaw", before);
  context.append("shared.events", "child");
  return context.snapshot();
};
      `,
      "utf8"
    );

    await fs.writeFile(
      parentPath,
      `
export const meta = { name: "context-parent", description: "parent context writer" };
export default async () => {
  context.set("shared.parentValue", "from-parent");
  context.append("shared.events", "parent-before");
  const childSnapshot = await workflow({ name: "context-child" });
  context.append("shared.events", "parent-after");
  return {
    childSnapshot,
    finalSnapshot: context.snapshot()
  };
};
      `,
      "utf8"
    );

    // Act
    const result = await runCli([
      "run",
      parentPath,
      "--config",
      configPath,
      "--provider",
      "mock",
      "--out",
      TEMP_DIR,
      "--cwd",
      TEMP_DIR,
      "--report",
      "json"
    ]);

    // Assert
    expect(result.error).toBeNull();

    const report = JSON.parse(result.stdout);
    expect(report.status).toBe("succeeded");
    expect(report.result.childSnapshot.shared.parentValue).toBe("from-parent");
    expect(report.result.childSnapshot.shared.childSaw).toBe("from-parent");
    expect(report.result.finalSnapshot.shared.parentValue).toBe("from-parent");
    expect(report.result.finalSnapshot.shared.childSaw).toBe("from-parent");
    expect(report.result.finalSnapshot.shared.events).toEqual(["parent-before", "child", "parent-after"]);
    expect(report.workflows.some((w: any) => w.workflowName === "context-child" && w.status === "succeeded")).toBe(true);
  });

  it("workflow({ context: ... }) is rejected as an unsupported workflow option naming context", () => {
    // Arrange
    const parsedWorkflow = createParsedWorkflow(
      `
        await workflow({ name: "child-workflow", context: { inherit: ["shared"] } });
      `,
      "workflow-context-overlay"
    );

    // Act
    const issues = validateWorkflow(parsedWorkflow, { allowImports: false as const });

    // Assert
    expect(issues.some((issue) => issue.message.includes("unsupported") && issue.message.includes("context"))).toBe(true);
  });

  it("ctx.workflow({ context: ... }) is rejected as an unsupported workflow option naming context", () => {
    // Arrange
    const parsedWorkflow = createParsedWorkflow(
      `
        export default async (ctx) => {
          await ctx.workflow({ name: "child-workflow", context: { merge: { shared: "replace" } } });
        };
      `,
      "ctx-workflow-context-overlay"
    );

    // Act
    const issues = validateWorkflow(parsedWorkflow, { allowImports: false as const });

    // Assert
    expect(issues.some((issue) => issue.message.includes("unsupported") && issue.message.includes("context"))).toBe(true);
  });
});
