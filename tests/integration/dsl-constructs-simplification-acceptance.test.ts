import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { main } from "../../src/cli/index.js";
import { validateWorkflow } from "../../src/workflow/validate.js";
import type { ParsedWorkflow } from "../../src/types/workflow.js";

const TEMP_DIR = path.resolve("tests/temp-dsl-constructs-simplification-acceptance");
const CONFIG_PATH = path.resolve("tests/fixtures/config/mock.config.yaml");

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

function createParsedWorkflow(name: string, body: string): ParsedWorkflow {
  return {
    meta: { name, description: `${name} acceptance workflow` },
    body,
    sourcePath: `${name}.workflow.js`,
    sourceText: body,
    sourceHash: `${name}-hash`
  };
}

function expectUnsupportedContextIssue(issues: Array<{ message: string }>) {
  expect(issues.some((issue) => issue.message.toLowerCase().includes("unsupported") && issue.message.toLowerCase().includes("context"))).toBe(true);
}

describe("DSL Constructs Simplification Acceptance", () => {
  beforeEach(async () => {
    await fs.rm(TEMP_DIR, { recursive: true, force: true });
    await fs.mkdir(TEMP_DIR, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(TEMP_DIR, { recursive: true, force: true });
  });

  it("rejects parallel(..., { context: ... }) during workflow validation", () => {
    // Arrange
    const workflow = createParsedWorkflow(
      "parallel-context",
      `
        export default async () => {
          await parallel([async () => 1], { context: { merge: { x: "replace" } } });
        };
      `
    );

    // Act
    const issues = validateWorkflow(workflow, { allowImports: false });

    // Assert
    expectUnsupportedContextIssue(issues);
  });

  it("rejects pipeline(..., { context: ... }) during workflow validation", () => {
    // Arrange
    const workflow = createParsedWorkflow(
      "pipeline-context",
      `
        export default async () => {
          await pipeline(
            ["alpha"],
            [{ name: "stage-1", run: async (item) => item }],
            { context: { merge: { x: "replace" } } }
          );
        };
      `
    );

    // Act
    const issues = validateWorkflow(workflow, { allowImports: false });

    // Assert
    expectUnsupportedContextIssue(issues);
  });

  it("rejects loop({ context: ... }) during workflow validation", () => {
    // Arrange
    const workflow = createParsedWorkflow(
      "loop-context",
      `
        export default async () => {
          await loop({
            label: "loop-context",
            initialState: { count: 0 },
            options: { maxRounds: 1 },
            context: { merge: { x: "replace" } },
            run: async (state) => ({ done: true, nextState: state })
          });
        };
      `
    );

    // Act
    const issues = validateWorkflow(workflow, { allowImports: false });

    // Assert
    expectUnsupportedContextIssue(issues);
  });

  it("runs parallel() using the global context binding directly", async () => {
    // Arrange
    const workflowPath = path.join(TEMP_DIR, "parallel-global-context.workflow.js");
    await fs.writeFile(
      workflowPath,
      `
export const meta = {
  name: "parallel-global-context",
  description: "parallel acceptance workflow"
};

context.set("parallel.seed", "seed");

const result = await parallel([
  async () => {
    const seed = context.get("parallel.seed");
    context.set("parallel.first", \`\${seed}:first\`);
    return context.get("parallel.first");
  },
  async () => {
    const seed = context.get("parallel.seed");
    context.set("parallel.second", \`\${seed}:second\`);
    return context.get("parallel.second");
  }
]);

export default {
  result,
  firstValue: context.get("parallel.first"),
  secondValue: context.get("parallel.second")
};
      `,
      "utf8"
    );

    // Act
    const result = await runCli([
      "run",
      workflowPath,
      "--config",
      CONFIG_PATH,
      "--out",
      TEMP_DIR,
      "--report",
      "json"
    ]);

    // Assert
    expect(result.error).toBeNull();
    const parsed = JSON.parse(result.stdout);
    expect(parsed.status).toBe("succeeded");
    expect(parsed.result.firstValue).toBe("seed:first");
    expect(parsed.result.secondValue).toBe("seed:second");
  });

  it("runs pipeline() using the global context binding and no ctx.context", async () => {
    // Arrange
    const workflowPath = path.join(TEMP_DIR, "pipeline-global-context.workflow.js");
    await fs.writeFile(
      workflowPath,
      `
export const meta = {
  name: "pipeline-global-context",
  description: "pipeline acceptance workflow"
};

context.set("pipeline.seed", "seed");

const result = await pipeline(
  ["alpha"],
  [
    {
      name: "capture-stage",
      run: async (item, ctx) => {
        if ("context" in ctx) {
          throw new Error("pipeline stage ctx.context should not be present");
        }

        const seed = context.get("pipeline.seed");
        context.set("pipeline.value", \`\${seed}:\${item}\`);
        return context.get("pipeline.value");
      }
    },
    {
      name: "final-stage",
      run: async (item, ctx) => {
        if ("context" in ctx) {
          throw new Error("pipeline stage ctx.context should not be present");
        }

        const current = context.get("pipeline.value");
        context.set("pipeline.final", \`\${current}:\${item}\`);
        return context.get("pipeline.final");
      }
    }
  ],
  { strategy: "stage-barrier" }
);

export default {
  result,
  finalValue: context.get("pipeline.final")
};
      `,
      "utf8"
    );

    // Act
    const result = await runCli([
      "run",
      workflowPath,
      "--config",
      CONFIG_PATH,
      "--out",
      TEMP_DIR,
      "--report",
      "json"
    ]);

    // Assert
    expect(result.error).toBeNull();
    const parsed = JSON.parse(result.stdout);
    expect(parsed.status).toBe("succeeded");
    expect(parsed.result.finalValue).toBe("seed:alpha:seed:alpha");
  });

  it("runs loop() using the global context binding and no ctx.context", async () => {
    // Arrange
    const workflowPath = path.join(TEMP_DIR, "loop-global-context.workflow.js");
    await fs.writeFile(
      workflowPath,
      `
export const meta = {
  name: "loop-global-context",
  description: "loop acceptance workflow"
};

context.set("loop.seed", "seed");

const result = await loop({
  label: "loop-global-context",
  initialState: { count: 0 },
  options: { maxRounds: 2 },
  run: async (state, ctx) => {
    if ("context" in ctx) {
      throw new Error("loop round ctx.context should not be present");
    }

    const round = state.count + 1;
    const previous = context.get("loop.value") ?? context.get("loop.seed");
    context.set("loop.value", \`\${previous}:\${round}\`);
    return {
      done: round >= 2,
      nextState: { count: round }
    };
  }
});

export default {
  result,
  finalValue: context.get("loop.value")
};
      `,
      "utf8"
    );

    // Act
    const result = await runCli([
      "run",
      workflowPath,
      "--config",
      CONFIG_PATH,
      "--out",
      TEMP_DIR,
      "--report",
      "json"
    ]);

    // Assert
    expect(result.error).toBeNull();
    const parsed = JSON.parse(result.stdout);
    expect(parsed.status).toBe("succeeded");
    expect(parsed.result.finalValue).toBe("seed:1:2");
  });
});
