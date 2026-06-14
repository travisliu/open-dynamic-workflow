import { describe, it, expect, vi } from "vitest";
import { DefaultRuntimeRunner } from "../../../src/workflow/runtime.js";
import { ErrorCode } from "../../../src/errors/codes.js";

describe("workflow() DSL", () => {
  const createDeps = () => ({
    agentExecutor: { execute: vi.fn() },
    eventSink: { emit: vi.fn() },
    artifactStore: { 
      isRunCreated: () => true,
      getRunArtifacts: () => ({ reportPath: "r.json", eventsPath: "e.jsonl" }),
      createRun: vi.fn(),
      updateManifest: vi.fn(),
      writeJson: vi.fn().mockResolvedValue(undefined)
    }
  } as any);

  it("exposes workflow() to the sandbox", async () => {
    const deps = createDeps();
    const runner = new DefaultRuntimeRunner();
    
    const parsedWorkflow = {
      meta: { name: "parent" },
      body: `export default async () => {
        return await workflow({ name: "child", args: { val: 123 } });
      }`,
      sourcePath: "parent.ts"
    } as any;

    const childDef = {
      name: "child",
      parsedWorkflow: {
        meta: { name: "child" },
        body: `export default async () => { return args.val; }`,
        sourcePath: "child.ts"
      }
    };

    const registry = {
      require: (name: string) => {
        if (name === "parent") return { name: "parent", parsedWorkflow };
        if (name === "child") return childDef;
        throw new Error(`Missing ${name}`);
      },
      get: (name: string) => {
        if (name === "parent") return { name: "parent", parsedWorkflow };
        if (name === "child") return childDef;
        return undefined;
      },
      names: () => new Set(["parent", "child"])
    } as any;

    const result = await runner.run({
      parsedWorkflow,
      workflowRegistry: registry,
      config: { concurrency: 1 } as any,
      cli: { args: {} } as any
    }, deps);

    if (result.status === "failed") {
      console.error(result.error);
    }

    expect(result.status).toBe("succeeded");
    expect(result.result).toBe(123);
  });

  it("provides isolated args to child", async () => {
     const deps = createDeps();
    const runner = new DefaultRuntimeRunner();
    
    const parsedWorkflow = {
      meta: { name: "parent" },
      body: `export default async () => {
        await workflow({ name: "child", args: { x: 1 } });
        return args.x; // Should be parent's x, not child's x
      }`,
      sourcePath: "parent.ts"
    } as any;

    const childDef = {
      name: "child",
      parsedWorkflow: {
        meta: { name: "child" },
        body: `export default async () => { return args.x; }`,
        sourcePath: "child.ts"
      }
    };

    const registry = {
      require: (name: string) => {
        if (name === "parent") return { name: "parent", parsedWorkflow };
        if (name === "child") return childDef;
        throw new Error(`Missing ${name}`);
      },
      get: (name: string) => {
        if (name === "parent") return { name: "parent", parsedWorkflow };
        if (name === "child") return childDef;
        return undefined;
      },
      names: () => new Set(["parent", "child"])
    } as any;

    const result = await runner.run({
      parsedWorkflow,
      workflowRegistry: registry,
      config: { concurrency: 1 } as any,
      cli: { args: { x: "parent-x" } } as any
    }, deps);

    if (result.status === "failed") {
      console.error(result.error);
    }

    expect(result.status).toBe("succeeded");
    expect(result.result).toBe("parent-x");
  });

  it("keeps nested workflow review-style results serializable", async () => {
    const deps = createDeps();
    const runner = new DefaultRuntimeRunner();
    const parsedWorkflow = {
      meta: { name: "review-loop", description: "review loop" },
      body: `
        const workflowName = "review-loop";

        async function runChild(iteration, goal) {
          return workflow({
            name: "child",
            args: { iteration, goal },
            metadata: {
              parentWorkflow: workflowName,
              iteration
            }
          });
        }

        async function reviewIteration(iteration, implementation) {
          const reviewResult = await agent({
            id: "review:" + iteration,
            provider: "mock",
            prompt: "review iteration " + iteration
          });
          const review = reviewResult.json;
          return {
            ...review,
            reviewArtifacts: reviewResult.artifacts,
            implementationSummary: implementation.implementations[0].summary
          };
        }

        let iteration = 1;
        let currentGoal = args.goal;
        let implementation = args.initialImplementation;
        let finalReview = null;
        const history = [];

        while (iteration <= 2) {
          finalReview = await reviewIteration(iteration, implementation);
          history.push({
            iteration,
            goal: currentGoal,
            review: finalReview,
            artifacts: {
              parseTasks: implementation.parsedTasksResult.artifacts,
              acceptanceTests: implementation.acceptanceTestsResult.artifacts,
              review: finalReview.reviewArtifacts
            }
          });

          if (!finalReview.hasIssues) {
            break;
          }

          currentGoal = finalReview.nextGoal;
          iteration += 1;
          implementation = await runChild(iteration, currentGoal);
        }

        export default {
          finalReview,
          history,
          finalGoal: currentGoal
        };
      `,
      sourcePath: "review-loop.ts"
    } as any;

    const implementationResult = {
      tasks: [
        {
          id: "task-1",
          sourcePlan: "docs/plan.md",
          prompt: "Implement the first change.",
          expectedFiles: ["src/example.ts"]
        }
      ],
      implementations: [{ summary: "Initial implementation" }],
      acceptanceTests: { summary: "Initial acceptance tests" },
      parsedTasksResult: {
        artifacts: {
          dir: "agents/parse-1",
          promptPath: "agents/parse-1/prompt.txt",
          stdoutPath: "agents/parse-1/stdout.log",
          stderrPath: "agents/parse-1/stderr.log"
        }
      },
      acceptanceTestsResult: {
        artifacts: {
          dir: "agents/acceptance-1",
          promptPath: "agents/acceptance-1/prompt.txt",
          stdoutPath: "agents/acceptance-1/stdout.log",
          stderrPath: "agents/acceptance-1/stderr.log"
        }
      }
    };

    const childDef = {
      name: "child",
      parsedWorkflow: {
        meta: { name: "child", description: "test child" },
        body: `export default {
          tasks: [
            {
              id: "task-2",
              sourcePlan: "docs/reviews/fix.md",
              prompt: "Apply the focused fix.",
              expectedFiles: ["src/fix.ts"]
            }
          ],
          implementations: [{ summary: "Focused fix implementation" }],
          acceptanceTests: { summary: "Focused fix acceptance tests" },
          parsedTasksResult: {
            artifacts: {
              dir: "agents/parse-2",
              promptPath: "agents/parse-2/prompt.txt",
              stdoutPath: "agents/parse-2/stdout.log",
              stderrPath: "agents/parse-2/stderr.log"
            }
          },
          acceptanceTestsResult: {
            artifacts: {
              dir: "agents/acceptance-2",
              promptPath: "agents/acceptance-2/prompt.txt",
              stdoutPath: "agents/acceptance-2/stdout.log",
              stderrPath: "agents/acceptance-2/stderr.log"
            }
          }
        };`,
        sourcePath: "child.js"
      }
    };

    const registry = {
      require: (name: string) => {
        if (name === "review-loop") return { name: "review-loop", parsedWorkflow };
        if (name === "child") return childDef;
        throw new Error(`Missing ${name}`);
      },
      get: (name: string) => {
        if (name === "review-loop") return { name: "review-loop", parsedWorkflow };
        if (name === "child") return childDef;
        return undefined;
      },
      names: () => new Set(["review-loop", "child"])
    } as any;

    const reviewResponses = [
      {
        hasIssues: true,
        summary: "Found issues",
        reviewReportPath: "docs/reviews/review-1.md",
        nextGoal: "Implement only the fixes from docs/reviews/review-1.md."
      },
      {
        hasIssues: false,
        summary: "No remaining issues",
        reviewReportPath: "",
        nextGoal: ""
      }
    ];

    deps.agentExecutor.execute = vi.fn(async (input: any) => {
      const review = reviewResponses.shift();
      if (!review) {
        throw new Error(`Unexpected agent call: ${input.id}`);
      }

      return {
        ok: true,
        status: "succeeded",
        id: input.id,
        provider: input.provider,
        json: review,
        stdout: JSON.stringify(review),
        stderr: "",
        exitCode: 0,
        durationMs: 5,
        artifacts: {
          dir: `agents/${input.id}`,
          promptPath: `agents/${input.id}/prompt.txt`,
          stdoutPath: `agents/${input.id}/stdout.log`,
          stderrPath: `agents/${input.id}/stderr.log`
        },
        permissions: input.permissions
      };
    });

    const result = await runner.run({
      parsedWorkflow,
      workflowRegistry: registry,
      config: { concurrency: 1 } as any,
      cli: {
        args: {
          goal: "Ship the feature safely.",
          maxIterations: 2,
          initialImplementation: implementationResult
        }
      } as any
    }, deps);

    expect(result.status).toBe("succeeded");
    expect(result.workflows?.some((summary: any) => summary.workflowName === "child")).toBe(true);
    expect((result.result as any).finalReview.hasIssues).toBe(false);
    expect((result.result as any).history).toHaveLength(2);
    expect(() => JSON.stringify(result)).not.toThrow();
  });

  it("keeps nested workflow review-style results serializable with string initialImplementation", async () => {
    const deps = createDeps();
    const runner = new DefaultRuntimeRunner();
    const parsedWorkflow = {
      meta: { name: "review-loop", description: "review loop" },
      body: `
        const workflowName = "review-loop";

        async function runChild(iteration, goal) {
          return workflow({
            name: "child",
            args: { iteration, goal },
            metadata: {
              parentWorkflow: workflowName,
              iteration
            }
          });
        }

        async function reviewIteration(iteration, implementation) {
          const reviewResult = await agent({
            id: "review:" + iteration,
            provider: "mock",
            prompt: "review iteration " + iteration
          });
          const review = reviewResult.json;
          return {
            ...review,
            reviewArtifacts: reviewResult.artifacts,
            implementationSummary: implementation.implementations[0].summary
          };
        }

        let iteration = 1;
        let currentGoal = args.goal;
        const rawImplementation = args.initialImplementation;
        const implementation = typeof rawImplementation === "string"
          ? {
              implementations: [{ summary: rawImplementation }],
              tasks: [],
              acceptanceTests: null,
              parsedTasksResult: null,
              acceptanceTestsResult: null
            }
          : {
              tasks: (rawImplementation && rawImplementation.tasks) || [],
              implementations: (rawImplementation && rawImplementation.implementations) || [],
              acceptanceTests: (rawImplementation && rawImplementation.acceptanceTests) || null,
              parsedTasksResult: (rawImplementation && rawImplementation.parsedTasksResult) || null,
              acceptanceTestsResult: (rawImplementation && rawImplementation.acceptanceTestsResult) || null
            };

        let currentImplementation = implementation;
        let finalReview = null;
        const history = [];

        while (iteration <= 2) {
          finalReview = await reviewIteration(iteration, currentImplementation);
          history.push({
            iteration,
            goal: currentGoal,
            review: finalReview,
            acceptanceTests: currentImplementation.acceptanceTests || null,
            artifacts: {
              parseTasks: currentImplementation.parsedTasksResult ? currentImplementation.parsedTasksResult.artifacts : [],
              acceptanceTests: currentImplementation.acceptanceTestsResult ? currentImplementation.acceptanceTestsResult.artifacts : [],
              review: finalReview.reviewArtifacts
            }
          });

          if (!finalReview.hasIssues) {
            break;
          }

          currentGoal = finalReview.nextGoal;
          iteration += 1;
          const childResult = await runChild(iteration, currentGoal);
          currentImplementation = {
            iteration,
            goal: currentGoal,
            tasks: childResult.tasks || [],
            implementations: childResult.implementations || [],
            acceptanceTestsResult: null,
            acceptanceTests: {
              id: "acceptance-tests:" + iteration,
              skipped: true,
              reason: "No dedicated acceptance-test agent ran.",
              text: "",
              artifacts: []
            }
          };
        }

        export default {
          finalReview,
          history,
          finalGoal: currentGoal
        };
      `,
      sourcePath: "review-loop.ts"
    } as any;

    const childDef = {
      name: "child",
      parsedWorkflow: {
        meta: { name: "child", description: "test child" },
        body: `export default {
          tasks: [
            {
              id: "task-2",
              sourcePlan: "docs/reviews/fix.md",
              prompt: "Apply the focused fix.",
              expectedFiles: ["src/fix.ts"]
            }
          ],
          implementations: [{ summary: "Focused fix implementation" }]
        };`,
        sourcePath: "child.js"
      }
    };

    const registry = {
      require: (name: string) => {
        if (name === "review-loop") return { name: "review-loop", parsedWorkflow };
        if (name === "child") return childDef;
        throw new Error(`Missing ${name}`);
      },
      get: (name: string) => {
        if (name === "review-loop") return { name: "review-loop", parsedWorkflow };
        if (name === "child") return childDef;
        return undefined;
      },
      names: () => new Set(["review-loop", "child"])
    } as any;

    const reviewResponses = [
      {
        hasIssues: true,
        summary: "Found issues",
        reviewReportPath: "docs/reviews/review-1.md",
        nextGoal: "Implement only the fixes from docs/reviews/review-1.md."
      },
      {
        hasIssues: false,
        summary: "No remaining issues",
        reviewReportPath: "",
        nextGoal: ""
      }
    ];

    deps.agentExecutor.execute = vi.fn(async (input: any) => {
      const review = reviewResponses.shift();
      if (!review) {
        throw new Error(`Unexpected agent call: ${input.id}`);
      }

      return {
        ok: true,
        status: "succeeded",
        id: input.id,
        provider: input.provider,
        json: review,
        stdout: JSON.stringify(review),
        stderr: "",
        exitCode: 0,
        durationMs: 5,
        artifacts: {
          dir: `agents/${input.id}`,
          promptPath: `agents/${input.id}/prompt.txt`,
          stdoutPath: `agents/${input.id}/stdout.log`,
          stderrPath: `agents/${input.id}/stderr.log`
        },
        permissions: input.permissions
      };
    });

    const result = await runner.run({
      parsedWorkflow,
      workflowRegistry: registry,
      config: { concurrency: 1 } as any,
      cli: {
        args: {
          goal: "Ship the feature safely.",
          maxIterations: 2,
          initialImplementation: "all git staged files."
        }
      } as any
    }, deps);

    expect(result.status).toBe("succeeded");
    expect(result.workflows?.some((summary: any) => summary.workflowName === "child")).toBe(true);
    expect((result.result as any).finalReview.hasIssues).toBe(false);
    expect((result.result as any).history).toHaveLength(2);
    expect(() => JSON.stringify(result)).not.toThrow();
  });
});
