import { describe, expect, it } from "vitest";
import { DefaultRuntimeRunner } from "../../../src/workflow/runtime.js";
import type { ParsedWorkflow } from "../../../src/types/workflow.js";
import type { ResolvedConfig, CliRunOptions } from "../../../src/types/config.js";
import type { AgentExecutor, AgentExecutionInput } from "../../../src/agents/execution-types.js";
import type { AgentResult } from "../../../src/types/agent.js";
import type { RuntimeEventSink } from "../../../src/orchestration/scheduler.js";
import { getActiveWorkflowInvocation } from "../../../src/workflow/invocation-types.js";

class FakeAgentExecutor implements AgentExecutor {
  active = 0;
  maxActive = 0;
  observedConcurrency?: number;

  async execute(input: AgentExecutionInput): Promise<AgentResult> {
    this.observedConcurrency = getActiveWorkflowInvocation()?.effectiveConcurrency;
    this.active += 1;
    this.maxActive = Math.max(this.maxActive, this.active);

    try {
      if (input.prompt.includes("fail")) {
        return {
          ok: false,
          status: "failed",
          id: input.id,
          provider: input.provider,
          stdout: "",
          stderr: "Simulated execution failure",
          exitCode: 1,
          durationMs: 5,
          artifacts: { dir: "", promptPath: "", stdoutPath: "", stderrPath: "" },
          error: { name: "AgentFailure", message: "Simulated execution failure", code: "PROVIDER_PROCESS_FAILED" },
          permissions: input.permissions
        };
      }
      return {
        ok: true,
        status: "succeeded",
        id: input.id,
        provider: input.provider,
        stdout: "mock response for " + input.prompt,
        stderr: "",
        exitCode: 0,
        durationMs: 5,
        artifacts: { dir: "", promptPath: "", stdoutPath: "", stderrPath: "" },
        permissions: input.permissions
      };
    } finally {
      this.active -= 1;
    }
  }
}

class FakeEventSink implements RuntimeEventSink {
  events: { type: string; payload: any }[] = [];
  emit(type: string, payload: any) {
    this.events.push({ type, payload });
  }
}

const mockClock = {
  now() {
    return new Date("2026-06-02T00:00:00.000Z");
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

describe("DefaultRuntimeRunner", () => {
  it("executes a workflow without agents successfully", async () => {
    const runner = new DefaultRuntimeRunner();
    const parsedWorkflow: ParsedWorkflow = {
      meta: { name: "simple", description: "simple run" },
      body: `
        phase("start");
        log("hello");
        export default { ok: true };
      `,
      sourcePath: "workflow.js",
      sourceText: `export const meta = { name: "simple", description: "simple run" };\nphase("start");\nlog("hello");\nexport default { ok: true };`,
      sourceHash: "123"
    };

    const eventSink = new FakeEventSink();
    const result = await runner.run(
      { parsedWorkflow, config: defaultResolvedConfig, cli: defaultCliOptions },
      { agentExecutor: new FakeAgentExecutor(), eventSink, clock: mockClock, idGenerator: mockIdGenerator }
    );

    expect(result.status).toBe("succeeded");
    expect(result.result).toEqual({ ok: true });
    expect(eventSink.events.map(e => e.type)).toContain("workflow.started");
    expect(eventSink.events.map(e => e.type)).toContain("phase.started");
    expect(eventSink.events.map(e => e.type)).toContain("workflow.log");
    expect(eventSink.events.map(e => e.type)).toContain("workflow.completed");
  });

  it("executes a workflow calling one agent successfully", async () => {
    const runner = new DefaultRuntimeRunner();
    const parsedWorkflow: ParsedWorkflow = {
      meta: { name: "agent-run", description: "run agent" },
      body: `
        const r = await agent({ id: "agent-1", prompt: "tell me a joke" });
        export default r;
      `,
      sourcePath: "workflow.js",
      sourceText: "",
      sourceHash: "123"
    };

    const eventSink = new FakeEventSink();
    const result = await runner.run(
      { parsedWorkflow, config: defaultResolvedConfig, cli: defaultCliOptions },
      { agentExecutor: new FakeAgentExecutor(), eventSink, clock: mockClock, idGenerator: mockIdGenerator }
    );

    expect(result.status).toBe("succeeded");
    expect((result.result as any).ok).toBe(true);
    expect((result.result as any).stdout).toContain("mock response for tell me a joke");
    expect(result.agents.length).toBe(1);
    expect(result.agents[0]!.id).toBe("agent-1");
  });

  it("fails before scheduling agents beyond maxAgentCalls", async () => {
    const runner = new DefaultRuntimeRunner();
    const parsedWorkflow: ParsedWorkflow = {
      meta: { name: "agent-limit", description: "run limit" },
      body: `
        await agent({ id: "agent-1", prompt: "first" });
        await agent({ id: "agent-2", prompt: "second" });
        export default "done";
      `,
      sourcePath: "workflow.js",
      sourceText: "",
      sourceHash: "123"
    };

    const eventSink = new FakeEventSink();
    const result = await runner.run(
      {
        parsedWorkflow,
        config: { ...defaultResolvedConfig, maxAgentCalls: 1 },
        cli: defaultCliOptions
      },
      { agentExecutor: new FakeAgentExecutor(), eventSink, clock: mockClock, idGenerator: mockIdGenerator }
    );

    expect(result.status).toBe("failed");
    expect(result.error?.code).toBe("RUN_LIMIT_EXCEEDED");
    expect(result.agents.map(agent => agent.id)).toEqual(["agent-1"]);
    expect(result.limitSummary).toMatchObject({
      limits: { maxAgentCalls: 1 },
      agentCalls: 1,
      exceeded: true,
      exceededBy: "maxAgentCalls"
    });
    const failedEvent = eventSink.events.find(event => event.type === "workflow.failed");
    expect(failedEvent?.payload.limitSummary?.exceededBy).toBe("maxAgentCalls");
  });

  it("handles parallel tasks with array input", async () => {
    const runner = new DefaultRuntimeRunner();
    const parsedWorkflow: ParsedWorkflow = {
      meta: { name: "parallel-array", description: "parallel array" },
      body: `
        const results = await parallel([
          () => agent({ prompt: "A" }),
          () => agent({ prompt: "B" })
        ]);
        export default results;
      `,
      sourcePath: "workflow.js",
      sourceText: "",
      sourceHash: "123"
    };

    const result = await runner.run(
      { parsedWorkflow, config: defaultResolvedConfig, cli: defaultCliOptions },
      { agentExecutor: new FakeAgentExecutor(), eventSink: new FakeEventSink(), clock: mockClock, idGenerator: mockIdGenerator }
    );

    expect(result.status).toBe("succeeded");
    expect(Array.isArray(result.result)).toBe(true);
    const arr = result.result as any[];
    expect(arr.length).toBe(2);
    expect(arr[0].stdout).toBe("mock response for A");
    expect(arr[1].stdout).toBe("mock response for B");
  });

  it("handles parallel tasks with object input", async () => {
    const runner = new DefaultRuntimeRunner();
    const parsedWorkflow: ParsedWorkflow = {
      meta: { name: "parallel-object", description: "parallel object" },
      body: `
        const results = await parallel({
          taskA: () => agent({ prompt: "A" }),
          taskB: () => agent({ prompt: "B" })
        });
        export default results;
      `,
      sourcePath: "workflow.js",
      sourceText: "",
      sourceHash: "123"
    };

    const result = await runner.run(
      { parsedWorkflow, config: defaultResolvedConfig, cli: defaultCliOptions },
      { agentExecutor: new FakeAgentExecutor(), eventSink: new FakeEventSink(), clock: mockClock, idGenerator: mockIdGenerator }
    );

    expect(result.status).toBe("succeeded");
    expect(typeof result.result).toBe("object");
    const obj = result.result as any;
    expect(obj.taskA.stdout).toBe("mock response for A");
    expect(obj.taskB.stdout).toBe("mock response for B");
  });

  it("returns failed run result when workflow body throws an error", async () => {
    const runner = new DefaultRuntimeRunner();
    const parsedWorkflow: ParsedWorkflow = {
      meta: { name: "throws", description: "throws" },
      body: `
        throw new Error("Syntax error or runtime exception");
      `,
      sourcePath: "workflow.js",
      sourceText: "",
      sourceHash: "123"
    };

    const result = await runner.run(
      { parsedWorkflow, config: defaultResolvedConfig, cli: defaultCliOptions },
      { agentExecutor: new FakeAgentExecutor(), eventSink: new FakeEventSink(), clock: mockClock, idGenerator: mockIdGenerator }
    );

    expect(result.status).toBe("failed");
    expect(result.error).toBeDefined();
    expect(result.error!.message).toBe("Syntax error or runtime exception");
  });

  it("returns cancelled run result when aborted externally", async () => {
    const runner = new DefaultRuntimeRunner();
    const parsedWorkflow: ParsedWorkflow = {
      meta: { name: "cancelled", description: "cancelled" },
      body: `
        await agent({ prompt: "long task" });
      `,
      sourcePath: "workflow.js",
      sourceText: "",
      sourceHash: "123"
    };

    const controller = new AbortController();
    const runPromise = runner.run(
      { parsedWorkflow, config: defaultResolvedConfig, cli: defaultCliOptions, signal: controller.signal },
      { agentExecutor: new FakeAgentExecutor(), eventSink: new FakeEventSink(), clock: mockClock, idGenerator: mockIdGenerator }
    );

    controller.abort("User cancelled execution");
    const result = await runPromise;

    expect(result.status).toBe("cancelled");
    expect(result.error).toBeDefined();
    expect(result.error!.message).toContain("User cancelled execution");
  });

  it("does NOT report SECURITY_POLICY_VIOLATION for regular ReferenceError", async () => {
    const runner = new DefaultRuntimeRunner();
    const parsedWorkflow: ParsedWorkflow = {
      meta: { name: "escape", description: "escape" },
      body: `
        const p = someNonExistentVariable;
        export default p;
      `,
      sourcePath: "workflow.js",
      sourceText: "",
      sourceHash: "123"
    };

    const result = await runner.run(
      { parsedWorkflow, config: defaultResolvedConfig, cli: defaultCliOptions },
      { agentExecutor: new FakeAgentExecutor(), eventSink: new FakeEventSink(), clock: mockClock, idGenerator: mockIdGenerator }
    );

    expect(result.status).toBe("failed");
    expect(result.error!.code).not.toBe("SECURITY_POLICY_VIOLATION");
    expect(result.error!.message).toContain("someNonExistentVariable is not defined");
  });

  it("does NOT report SECURITY_POLICY_VIOLATION for errors mentioning constructor", async () => {
    const runner = new DefaultRuntimeRunner();
    const parsedWorkflow: ParsedWorkflow = {
      meta: { name: "constructor-err", description: "constructor-err" },
      body: `
        throw new Error("Something went wrong in the constructor");
      `,
      sourcePath: "workflow.js",
      sourceText: "",
      sourceHash: "123"
    };

    const result = await runner.run(
      { parsedWorkflow, config: defaultResolvedConfig, cli: defaultCliOptions },
      { agentExecutor: new FakeAgentExecutor(), eventSink: new FakeEventSink(), clock: mockClock, idGenerator: mockIdGenerator }
    );

    expect(result.status).toBe("failed");
    expect(result.error!.code).not.toBe("SECURITY_POLICY_VIOLATION");
    expect(result.error!.message).toContain("constructor");
  });

  it("verify status remains 'failed' even if error message contains 'cancelled'", async () => {
    const runner = new DefaultRuntimeRunner();
    const parsedWorkflow: ParsedWorkflow = {
      meta: { name: "cancelled-msg", description: "cancelled-msg" },
      body: `
        throw new Error("The subscription was cancelled by the user");
      `,
      sourcePath: "workflow.js",
      sourceText: "",
      sourceHash: "123"
    };

    const result = await runner.run(
      { parsedWorkflow, config: defaultResolvedConfig, cli: defaultCliOptions },
      { agentExecutor: new FakeAgentExecutor(), eventSink: new FakeEventSink(), clock: mockClock, idGenerator: mockIdGenerator }
    );

    expect(result.status).toBe("failed");
    expect(result.error!.message).toContain("cancelled");
  });

  it("reports status 'failed' when fail-fast is triggered by agent failure", async () => {
    const runner = new DefaultRuntimeRunner();
    const parsedWorkflow: ParsedWorkflow = {
      meta: { name: "fail-fast", description: "fail-fast" },
      body: `
        await agent({ prompt: "this will fail" });
        await agent({ prompt: "this should not run" });
      `,
      sourcePath: "workflow.js",
      sourceText: "",
      sourceHash: "123"
    };

    const cliOptions = { ...defaultCliOptions, failFast: true };
    const result = await runner.run(
      { parsedWorkflow, config: defaultResolvedConfig, cli: cliOptions },
      { agentExecutor: new FakeAgentExecutor(), eventSink: new FakeEventSink(), clock: mockClock, idGenerator: mockIdGenerator }
    );

    expect(result.status).toBe("failed");
    expect(result.agents.length).toBe(2);
    expect(result.agents[0].status).toBe("failed");
    expect(result.agents[1].status).toBe("skipped");
  });

  it("retains resolved permissions on final agent results", async () => {
    const runner = new DefaultRuntimeRunner();
    const parsedWorkflow: ParsedWorkflow = {
      meta: { name: "permissions-test", description: "permissions-test" },
      body: `
        const res1 = await agent({ prompt: "hello", permissions: { mode: "dangerously-full-access" } });
        const res2 = await agent({ prompt: "world" });
        export default [res1, res2];
      `,
      sourcePath: "workflow.js",
      sourceText: "",
      sourceHash: "123"
    };

    const result = await runner.run(
      { parsedWorkflow, config: defaultResolvedConfig, cli: defaultCliOptions },
      { agentExecutor: new FakeAgentExecutor(), eventSink: new FakeEventSink(), clock: mockClock, idGenerator: mockIdGenerator }
    );

    expect(result.status).toBe("succeeded");
    expect(result.agents).toHaveLength(2);
    expect(result.agents[0]!.permissions).toEqual({ mode: "dangerously-full-access" });
    expect(result.agents[1]!.permissions).toEqual({ mode: "default" });
  });

  it("seeds root invocation context effectiveConcurrency with CLI/config scheduler limit", async () => {
    const runner = new DefaultRuntimeRunner();
    const parsedWorkflow: ParsedWorkflow = {
      meta: { name: "concurrency-test", description: "concurrency-test" },
      body: `
        await agent({ prompt: "hello" });
        export default { ok: true };
      `,
      sourcePath: "workflow.js",
      sourceText: "",
      sourceHash: "123"
    };

    const executor = new FakeAgentExecutor();
    const cliOptions = { ...defaultCliOptions, concurrency: 5 };
    const result = await runner.run(
      { parsedWorkflow, config: defaultResolvedConfig, cli: cliOptions },
      { agentExecutor: executor, eventSink: new FakeEventSink(), clock: mockClock, idGenerator: mockIdGenerator }
    );

    expect(result.status).toBe("succeeded");
    expect(executor.observedConcurrency).toBe(5);
  });
});
