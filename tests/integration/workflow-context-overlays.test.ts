import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { main } from "../../src/cli/index.js";

const TEMP_DIR = path.resolve("tests/temp-workflow-context-overlays");
const WORKFLOWS_DIR = path.join(TEMP_DIR, "workflows");
const RUNS_DIR = path.join(TEMP_DIR, "runs");
const CONFIG_PATH = path.join(TEMP_DIR, "open-dynamic-workflow.config.yaml");

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
    error,
  };
}

async function writeWorkflow(fileName: string, source: string): Promise<string> {
  const workflowPath = path.join(WORKFLOWS_DIR, fileName);
  await fs.writeFile(workflowPath, source, "utf8");
  return workflowPath;
}

async function writeConfig(): Promise<void> {
  const workflowGlob = "workflows/**/*.workflow.js";
  await fs.writeFile(
    CONFIG_PATH,
    `
defaultProvider: mock
providers:
  mock:
    command: mock
workflow:
  discovery:
    include:
      - ${JSON.stringify(workflowGlob)}
`,
    "utf8"
  );
}

async function readRunDir(): Promise<string> {
  const entries = await fs.readdir(RUNS_DIR, { withFileTypes: true });
  const runDirEntry = entries.find((entry) => entry.isDirectory());
  if (!runDirEntry) {
    throw new Error("Run directory not created");
  }
  return path.join(RUNS_DIR, runDirEntry.name);
}

async function readJson(filePath: string): Promise<any> {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

describe("Workflow Context Overlays", () => {
  beforeEach(async () => {
    await fs.rm(TEMP_DIR, { recursive: true, force: true });
    await fs.mkdir(WORKFLOWS_DIR, { recursive: true });
    await fs.mkdir(RUNS_DIR, { recursive: true });
    await writeConfig();
  });

  afterEach(async () => {
    await fs.rm(TEMP_DIR, { recursive: true, force: true });
  });

  it("keeps child workflows isolated until explicit merge rules allow parent updates", async () => {
    // Arrange
    await writeWorkflow(
      "child.workflow.js",
      `
export const meta = { name: "context-child", description: "child workflow isolation" };

export default async () => {
  const inherited = context.get("shared.value");
  context.set("shared.value", inherited + "-child");
  context.set("shared.childOnly", "visible-after-merge");

  return {
    inherited,
    childSnapshot: context.snapshot({ metadata: true })
  };
};
`
    );

    const parentPath = await writeWorkflow(
      "parent.workflow.js",
      `
export const meta = { name: "context-parent", description: "parent workflow isolation" };

export default async () => {
  context.set("shared.value", "parent");
  const beforeChild = context.get("shared.value");

  const child = await workflow({
    name: "context-child",
    context: {
      inherit: ["shared.value"],
      merge: {
        "shared.value": "replace",
        "shared.childOnly": "replace"
      }
    }
  });

  const afterChild = context.get("shared.value");
  const childOnly = context.get("shared.childOnly");

  return {
    beforeChild,
    afterChild,
    childOnly,
    child
  };
};
`
    );

    // Act
    const result = await runCli([
      "run",
      parentPath,
      "--config",
      CONFIG_PATH,
      "--cwd",
      TEMP_DIR,
      "--out",
      RUNS_DIR,
      "--report",
      "json",
    ]);

    // Assert
    expect(result.error).toBeNull();

    const report = JSON.parse(result.stdout);
    expect(report.status).toBe("succeeded");
    expect(report.workflows).toHaveLength(2);
    expect(report.result.beforeChild).toBe("parent");
    expect(report.result.afterChild).toBe("parent-child");
    expect(report.result.childOnly).toBe("visible-after-merge");
    expect(report.result.child.inherited).toBe("parent");
    expect(report.result.child.childSnapshot.metadata.scopeId).toBeDefined();
    expect(report.result.child.childSnapshot.metadata.visibleScopes).toContain(report.runId);

    const runDir = path.join(RUNS_DIR, report.runId);
    expect(await fs.stat(path.join(runDir, "report.json"))).toBeDefined();
    expect(await fs.stat(path.join(runDir, "events.jsonl"))).toBeDefined();

    const rootFinalPath = path.join(runDir, "context/root-final.json");
    const summaryPath = path.join(runDir, "context/summary.json");
    expect(await fs.stat(rootFinalPath)).toBeDefined();
    expect(await fs.stat(summaryPath)).toBeDefined();

    const rootFinalJson = await readJson(rootFinalPath);
    expect(rootFinalJson.runId).toBe(report.runId);
    expect(rootFinalJson.values).toBeDefined();

    const summaryJson = await readJson(summaryPath);
    expect(summaryJson.totalOverlays).toBeGreaterThan(0);
    expect(summaryJson.overlayPatchArtifactPaths).toBeDefined();

    const patchPaths = Object.values(summaryJson.overlayPatchArtifactPaths);
    expect(patchPaths.length).toBeGreaterThan(0);
    const firstPatchPath = path.join(runDir, patchPaths[0] as string);
    expect(await fs.stat(firstPatchPath)).toBeDefined();

    expect(report.context).toBeDefined();
    expect(report.context.rootFinalArtifact).toBe("context/root-final.json");
    expect(report.context.summaryArtifact).toBe("context/summary.json");
    expect(report.context.overlayCount).toBe(1);
    expect(report.context.conflictCount).toBe(0);
    expect(report.context.rejectedWriteCount).toBe(0);
  });

  it("fails a child workflow startup when a required inherited path is missing", async () => {
    // Arrange
    await writeWorkflow(
      "missing-child.workflow.js",
      `
export const meta = { name: "missing-child", description: "missing inherit child" };

export default async () => {
  return "should-not-run";
};
`
    );

    const parentPath = await writeWorkflow(
      "missing-parent.workflow.js",
      `
export const meta = { name: "missing-parent", description: "missing inherit parent" };

export default async () => {
  return await workflow({
    name: "missing-child",
    context: {
      inherit: ["required.path"]
    }
  });
};
`
    );

    // Act
    const result = await runCli([
      "run",
      parentPath,
      "--config",
      CONFIG_PATH,
      "--cwd",
      TEMP_DIR,
      "--out",
      RUNS_DIR,
      "--report",
      "json",
    ]);

    // Assert
    expect(result.error).not.toBeNull();
    expect(result.error?.code).toBe("CONTEXT_INHERIT_PATH_NOT_FOUND");

    const report = JSON.parse(result.stdout);
    expect(report.status).toBe("failed");
    expect(report.error.code).toBe("CONTEXT_INHERIT_PATH_NOT_FOUND");
  });

  it("merges loop rounds sequentially with isolated round overlays", async () => {
    // Arrange
    const loopPath = await writeWorkflow(
      "loop.workflow.js",
      `
export const meta = { name: "context-loop", description: "loop overlay merge" };

context.set("timeline", []);

const result = await loop({
  label: "timeline-loop",
  initialState: { round: 0 },
  options: { maxRounds: 3 },
  context: {
    merge: {
      timeline: "append"
    }
  },
  run: async (state, ctx) => {
    ctx.context.append("timeline", "round-" + state.round);
    return {
      done: state.round >= 2,
      nextState: { round: state.round + 1 }
    };
  }
});

export default {
  result,
  timeline: context.get("timeline")
};
`
    );

    // Act
    const result = await runCli([
      "run",
      loopPath,
      "--config",
      CONFIG_PATH,
      "--cwd",
      TEMP_DIR,
      "--out",
      RUNS_DIR,
      "--report",
      "jsonl",
    ]);

    // Assert
    expect(result.error).toBeNull();

    const jsonlLines = result.stdout.trim().split("\n").filter(Boolean);
    expect(jsonlLines.length).toBeGreaterThan(0);
    for (const line of jsonlLines) {
      expect(() => JSON.parse(line)).not.toThrow();
    }

    const runDir = await readRunDir();
    const report = await readJson(path.join(runDir, "report.json"));
    expect(report.status).toBe("succeeded");
    expect(report.loops).toHaveLength(1);
    expect(report.loops[0].status).toBe("succeeded");
    expect(report.loops[0].roundsCompleted).toBe(3);
    expect(report.result.timeline).toEqual(["round-0", "round-1", "round-2"]);
  });

  it("keeps pipeline stages isolated and preserves deterministic stage ordering", async () => {
    // Arrange
    const pipelinePath = await writeWorkflow(
      "pipeline.workflow.js",
      `
export const meta = { name: "context-pipeline", description: "pipeline overlay merge" };

const items = ["item-1"];
const stages = [
  {
    name: "write",
    run: async (item, ctx) => {
      ctx.context.set("pipeline.shared", item + "-stage1");
      return {
        wrote: ctx.context.get("pipeline.shared")
      };
    }
  },
  {
    name: "read",
    run: async (item, ctx) => {
      return {
        seen: ctx.context.get("pipeline.shared") ?? null
      };
    }
  }
];

const result = await pipeline(items, stages, {
  strategy: "stage-barrier",
  context: {
    merge: {
      "pipeline.shared": "replace"
    }
  }
});

export default {
  result,
  finalValue: context.get("pipeline.shared")
};
`
    );

    // Act
    const result = await runCli([
      "run",
      pipelinePath,
      "--config",
      CONFIG_PATH,
      "--cwd",
      TEMP_DIR,
      "--out",
      RUNS_DIR,
      "--report",
      "json",
    ]);

    // Assert
    expect(result.error).toBeNull();

    const report = JSON.parse(result.stdout);
    expect(report.status).toBe("succeeded");
    expect(report.pipelines).toHaveLength(1);
    expect(report.result.finalValue).toBe("item-1-stage1");
    expect(report.result.result[0].stages[1].value.seen).toBeNull();
  });

  it("rejects conflicting parallel branch writes deterministically", async () => {
    // Arrange
    const parallelPath = await writeWorkflow(
      "parallel.workflow.js",
      `
export const meta = { name: "context-parallel", description: "parallel overlay conflict" };

context.set("shared.value", "root");

const result = await parallel([
  async () => {
    context.set("shared.value", "branch-a");
    return "a";
  },
  async () => {
    context.set("shared.value", "branch-b");
    return "b";
  }
], {
  context: {
    merge: {
      "shared.value": "rejectOnConflict"
    }
  }
});

export default result;
`
    );

    // Act
    const first = await runCli([
      "run",
      parallelPath,
      "--config",
      CONFIG_PATH,
      "--cwd",
      TEMP_DIR,
      "--out",
      RUNS_DIR,
      "--report",
      "json",
    ]);

    const second = await runCli([
      "run",
      parallelPath,
      "--config",
      CONFIG_PATH,
      "--cwd",
      TEMP_DIR,
      "--out",
      RUNS_DIR,
      "--report",
      "json",
    ]);

    // Assert
    expect(first.error).not.toBeNull();
    expect(second.error).not.toBeNull();
    expect(first.error?.code).toBe("CONTEXT_MERGE_CONFLICT");
    expect(second.error?.code).toBe("CONTEXT_MERGE_CONFLICT");
    const normalizeConflictMessage = (message: string) =>
      message
        .replace(/scope '[^']+'/g, "scope '<scope>'")
        .replace(/parent '[^']+'/g, "parent '<scope>'");
    expect(normalizeConflictMessage(first.error?.message ?? "")).toBe(
      normalizeConflictMessage(second.error?.message ?? "")
    );

    const firstReport = JSON.parse(first.stdout);
    const secondReport = JSON.parse(second.stdout);
    expect(firstReport.status).toBe("failed");
    expect(secondReport.status).toBe("failed");
    expect(firstReport.error.code).toBe("CONTEXT_MERGE_CONFLICT");
    expect(secondReport.error.code).toBe("CONTEXT_MERGE_CONFLICT");

    // Check that context artifacts exist on the failed/conflict run
    const runDir = path.join(RUNS_DIR, firstReport.runId);
    const rootFinalPath = path.join(runDir, "context/root-final.json");
    const summaryPath = path.join(runDir, "context/summary.json");
    expect(await fs.stat(rootFinalPath)).toBeDefined();
    expect(await fs.stat(summaryPath)).toBeDefined();

    const summaryJson = await readJson(summaryPath);
    expect(summaryJson.conflictCount).toBeGreaterThan(0);

    expect(firstReport.context).toBeDefined();
    expect(firstReport.context.rootFinalArtifact).toBe("context/root-final.json");
    expect(firstReport.context.summaryArtifact).toBe("context/summary.json");
    expect(firstReport.context.conflictCount).toBeGreaterThan(0);
  });

  it("fails a workflow run when a deferred overlay merge conflict occurs in a parallel group", async () => {
    // Arrange
    const parallelConflictPath = await writeWorkflow(
      "parallel-conflict.workflow.js",
      `
export const meta = { name: "parallel-deferred-conflict", description: "parallel deferred conflict test" };

context.set("target", "not-an-array");

const result = await parallel([
  async () => {
    context.append("target", "value-1");
    return "a";
  }
], {
  context: {
    merge: {
      "target": "append"
    }
  }
});

export default result;
`
    );

    // Act
    const result = await runCli([
      "run",
      parallelConflictPath,
      "--config",
      CONFIG_PATH,
      "--cwd",
      TEMP_DIR,
      "--out",
      RUNS_DIR,
      "--report",
      "json",
    ]);

    // Assert
    expect(result.error).not.toBeNull();
    const report = JSON.parse(result.stdout);
    expect(report.status).toBe("failed");
    expect(report.error.code).toBe("CONTEXT_MERGE_CONFLICT");
    expect(report.context.conflictCount).toBe(1);

    // Check that context artifacts exist on the failed/conflict run
    const runDir = path.join(RUNS_DIR, report.runId);
    const rootFinalPath = path.join(runDir, "context/root-final.json");
    const summaryPath = path.join(runDir, "context/summary.json");
    expect(await fs.stat(rootFinalPath)).toBeDefined();
    expect(await fs.stat(summaryPath)).toBeDefined();
  });
});
