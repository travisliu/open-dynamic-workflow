import { describe, expect, it } from "vitest";
import { DefaultRuntimeRunner } from "../../../src/workflow/runtime.js";
import type { ParsedWorkflow } from "../../../src/types/workflow.js";
import type { ResolvedConfig, CliRunOptions } from "../../../src/types/config.js";
import type { AgentExecutor, AgentExecutionInput } from "../../../src/agents/execution-types.js";
import type { AgentResult } from "../../../src/types/agent.js";
import type { RuntimeEventSink } from "../../../src/orchestration/scheduler.js";

// ---- Helpers ----

class SlowFakeAgentExecutor implements AgentExecutor {
  delayMs: number;
  constructor(delayMs = 50) {
    this.delayMs = delayMs;
  }

  async execute(input: AgentExecutionInput): Promise<AgentResult> {
    return new Promise<AgentResult>((resolve, reject) => {
      const timeout = setTimeout(() => {
        resolve({
          ok: true,
          status: "succeeded",
          id: input.id,
          provider: input.provider,
          stdout: "completed",
          stderr: "",
          exitCode: 0,
          durationMs: this.delayMs,
          artifacts: { dir: "", promptPath: "", stdoutPath: "", stderrPath: "" }
        });
      }, this.delayMs);

      input.signal.addEventListener("abort", () => {
        clearTimeout(timeout);
        reject(Object.assign(new Error(String(input.signal.reason || "aborted")), { name: "AbortError" }));
      });
    });
  }
}

class FakeEventSink implements RuntimeEventSink {
  events: { type: string; payload: unknown }[] = [];
  emit(type: string, payload: unknown) {
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
    return `${prefix}-test-1`;
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

const defaultConfig: ResolvedConfig = {
  defaultProvider: "mock",
  concurrency: 2,
  timeoutMs: 30000,
  providers: {},
  security: { allowShell: false, allowWorkflowImports: false, passEnv: [], redactEnv: [] },
  reporting: { mode: "pretty", verbose: false },
  cwd: "/workspace",
  outDir: "/workspace/.execflow/runs",
  cliArgs: {}
};

// ---- Tests ----

describe("Runtime cancellation behavior", () => {
  it("returns cancelled result when aborted before execution starts", async () => {
    const runner = new DefaultRuntimeRunner();
    const parsedWorkflow: ParsedWorkflow = {
      meta: { name: "cancel-test", description: "test" },
      body: `
        await agent({ id: "slow-task", prompt: "wait" });
        export default { done: true };
      `,
      sourcePath: "workflow.js",
      sourceText: "",
      sourceHash: "abc"
    };

    const controller = new AbortController();
    controller.abort("User cancelled before start");

    const result = await runner.run(
      {
        parsedWorkflow,
        config: defaultConfig,
        cli: defaultCliOptions,
        signal: controller.signal
      },
      {
        agentExecutor: new SlowFakeAgentExecutor(100),
        eventSink: new FakeEventSink(),
        clock: mockClock,
        idGenerator: mockIdGenerator
      }
    );

    expect(result.status).toBe("cancelled");
    expect(result.error).toBeDefined();
  });

  it("returns cancelled result when aborted during execution", async () => {
    const runner = new DefaultRuntimeRunner();
    const parsedWorkflow: ParsedWorkflow = {
      meta: { name: "cancel-during", description: "test" },
      body: `
        await agent({ id: "slow-task", prompt: "wait" });
        export default { done: true };
      `,
      sourcePath: "workflow.js",
      sourceText: "",
      sourceHash: "abc"
    };

    const controller = new AbortController();

    const runPromise = runner.run(
      {
        parsedWorkflow,
        config: defaultConfig,
        cli: defaultCliOptions,
        signal: controller.signal
      },
      {
        agentExecutor: new SlowFakeAgentExecutor(200),
        eventSink: new FakeEventSink(),
        clock: mockClock,
        idGenerator: mockIdGenerator
      }
    );

    // Abort after a short delay while agent is running
    setTimeout(() => controller.abort("Mid-run cancel"), 30);

    const result = await runPromise;

    expect(result.status).toBe("cancelled");
    expect(result.error).toBeDefined();
    expect(result.error!.message).toContain("Mid-run cancel");
  });

  it("emits workflow.cancelled event when cancelled", async () => {
    const runner = new DefaultRuntimeRunner();
    const parsedWorkflow: ParsedWorkflow = {
      meta: { name: "cancel-event", description: "test" },
      body: `
        await agent({ id: "slow-task", prompt: "wait" });
        export default { done: true };
      `,
      sourcePath: "workflow.js",
      sourceText: "",
      sourceHash: "abc"
    };

    const controller = new AbortController();
    const eventSink = new FakeEventSink();

    const runPromise = runner.run(
      {
        parsedWorkflow,
        config: defaultConfig,
        cli: defaultCliOptions,
        signal: controller.signal
      },
      {
        agentExecutor: new SlowFakeAgentExecutor(200),
        eventSink,
        clock: mockClock,
        idGenerator: mockIdGenerator
      }
    );

    setTimeout(() => controller.abort("Cancel for event test"), 30);

    await runPromise;

    const cancelledEvent = eventSink.events.find((e) => e.type === "workflow.cancelled");
    expect(cancelledEvent).toBeDefined();
  });

  it("cancellation propagates abort signal to running agent task", async () => {
    let agentSignalAborted = false;

    const capturingExecutor: AgentExecutor = {
      async execute(input: AgentExecutionInput): Promise<AgentResult> {
        return new Promise<AgentResult>((resolve, reject) => {
          const timeout = setTimeout(() => {
            resolve({
              ok: true,
              status: "succeeded",
              id: input.id,
              provider: input.provider,
              stdout: "done",
              stderr: "",
              exitCode: 0,
              durationMs: 200,
              artifacts: { dir: "", promptPath: "", stdoutPath: "", stderrPath: "" }
            });
          }, 200);

          input.signal.addEventListener("abort", () => {
            agentSignalAborted = true;
            clearTimeout(timeout);
            reject(Object.assign(new Error("AbortError"), { name: "AbortError" }));
          });
        });
      }
    };

    const runner = new DefaultRuntimeRunner();
    const parsedWorkflow: ParsedWorkflow = {
      meta: { name: "signal-propagation", description: "test" },
      body: `
        await agent({ id: "running-agent", prompt: "wait" });
        export default { done: true };
      `,
      sourcePath: "workflow.js",
      sourceText: "",
      sourceHash: "abc"
    };

    const controller = new AbortController();

    const runPromise = runner.run(
      {
        parsedWorkflow,
        config: defaultConfig,
        cli: defaultCliOptions,
        signal: controller.signal
      },
      {
        agentExecutor: capturingExecutor,
        eventSink: new FakeEventSink(),
        clock: mockClock,
        idGenerator: mockIdGenerator
      }
    );

    setTimeout(() => controller.abort("Propagation test"), 30);

    await runPromise;

    expect(agentSignalAborted).toBe(true);
  });

  it("no task remains running after abort - drain completes", async () => {
    const runner = new DefaultRuntimeRunner();
    const parsedWorkflow: ParsedWorkflow = {
      meta: { name: "drain-after-cancel", description: "test" },
      body: `
        await parallel([
          () => agent({ id: "t1", prompt: "slow" }),
          () => agent({ id: "t2", prompt: "slow" })
        ]);
        export default { done: true };
      `,
      sourcePath: "workflow.js",
      sourceText: "",
      sourceHash: "abc"
    };

    const controller = new AbortController();

    const runPromise = runner.run(
      {
        parsedWorkflow,
        config: { ...defaultConfig, concurrency: 2 },
        cli: { ...defaultCliOptions, concurrency: 2 },
        signal: controller.signal
      },
      {
        agentExecutor: new SlowFakeAgentExecutor(200),
        eventSink: new FakeEventSink(),
        clock: mockClock,
        idGenerator: mockIdGenerator
      }
    );

    setTimeout(() => controller.abort("Drain test cancel"), 30);

    // Should resolve cleanly (not hang)
    const result = await runPromise;
    expect(result.status).toBe("cancelled");
  });
});
