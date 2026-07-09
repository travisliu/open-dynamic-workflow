import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import { main } from "../../src/cli/index.js";

const TEMP_DIR = path.resolve("tests/temp-pipeline-mock-provider");

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

describe("Pipeline Mock Provider Integration", () => {
  beforeEach(async () => {
    await fs.rm(TEMP_DIR, { recursive: true, force: true });
    await fs.mkdir(TEMP_DIR, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(TEMP_DIR, { recursive: true, force: true });
  });

  it("successfully invokes mock provider through pipeline stages", async () => {
    const workflowPath = path.join(TEMP_DIR, "mock-provider-flow.workflow.js");
    const configPath = path.join(TEMP_DIR, "mock-provider-config.yaml");

    await fs.writeFile(workflowPath, `
export const meta = {
  name: "mock-provider-pipeline",
  description: "Runs mock provider through named stages"
};

const items = ["taskA", "taskB"];
const stages = [
  {
    name: "first-phase",
    run: async (item, ctx) => {
      context.set("stage1_" + ctx.itemIndex, "wrote-" + ctx.itemIndex);
      const response = await ctx.agent({
        id: ctx.agentId("agentA"),
        label: \`label-A-\${ctx.itemIndex}\`,
        prompt: \`process \${item}\`
      });
      return response.text;
    }
  },
  {
    name: "second-phase",
    run: async (item, ctx) => {
      const savedVal = context.get("stage1_" + ctx.itemIndex);
      const response = await ctx.agent({
        id: ctx.agentId("agentB"),
        label: \`label-B-\${ctx.itemIndex}\`,
        prompt: \`analyze \${item}\`
      });
      return response.text + "-" + savedVal;
    }
  }
];

await pipeline(items, stages, { strategy: "stage-barrier" });
    `, "utf8");

    await fs.writeFile(configPath, `
defaultProvider: mock
providers:
  mock:
    command: mock
    responses:
      label-A-0:
        text: "response-A-0"
      label-A-1:
        text: "response-A-1"
      label-B-0:
        text: "response-B-0"
      label-B-1:
        text: "response-B-1"
    `, "utf8");

    const result = await runCli([
      "run",
      workflowPath,
      "--config", configPath,
      "--out", TEMP_DIR,
      "--report", "json"
    ]);

    expect(result.error).toBeNull();

    const report = JSON.parse(result.stdout);
    expect(report.status).toBe("succeeded");
    expect(report.pipelines[0].succeededCount).toBe(2);

    const runs = (await fs.readdir(TEMP_DIR)).filter(item => !item.endsWith(".js") && !item.endsWith(".yaml"));
    const runDir = path.join(TEMP_DIR, runs[0]!);

    const pipelinesDir = path.join(runDir, "pipelines");
    const pipelines = await fs.readdir(pipelinesDir);
    const pipelineId = pipelines[0]!;

    // Assert stage 1 output from item 0
    const stage1Item0Path = path.join(runDir, `pipelines/${pipelineId}/items/0/stages/first-phase/stage-result.json`);
    const stage1Item0Data = JSON.parse(await fs.readFile(stage1Item0Path, "utf8"));
    expect(stage1Item0Data.value).toBe("response-A-0");

    // Assert stage 2 output from item 1
    const stage2Item1Path = path.join(runDir, `pipelines/${pipelineId}/items/1/stages/second-phase/stage-result.json`);
    const stage2Item1Data = JSON.parse(await fs.readFile(stage2Item1Path, "utf8"));
    expect(stage2Item1Data.value).toBe("response-B-1-wrote-1");
  });
});
