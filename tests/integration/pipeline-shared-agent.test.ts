import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { main } from "../../src/cli/index.js";
import * as path from "node:path";
import * as fs from "node:fs/promises";

const TEMP_DIR = path.resolve("tests/temp-pipeline-shared-agent");

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
    await main(["node", "openflow", ...args]);
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

describe("Pipeline Shared Agent Integration", () => {
  beforeEach(async () => {
    await fs.rm(TEMP_DIR, { recursive: true, force: true });
    await fs.mkdir(TEMP_DIR, { recursive: true });
    await fs.mkdir(path.join(TEMP_DIR, ".openflow/agents"), { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(TEMP_DIR, { recursive: true, force: true });
  });

  it("runs a shared agent within a pipeline stage", async () => {
    // 1. Create shared agent definition
    const agentDef = `
export default defineAgent({
  id: "summarizer",
  description: "Summarize text",
  inputSchema: {
    type: "object",
    properties: {
      text: { type: "string" }
    }
  },
  agentPrompt: "Summarize this: {{text}}",
  run: async (context, runtime) => {
    return await runtime.agent({
      prompt: runtime.renderAgentPrompt(context),
      provider: "mock"
    });
  }
});
`;
    await fs.writeFile(path.join(TEMP_DIR, ".openflow/agents/summarizer.agent.js"), agentDef);

    // 2. Create workflow with pipeline
    const workflow = `
export const meta = { name: "pipeline-shared-agent-test", description: "test", version: "0.1.0" };

const items = ["item1", "item2"];

const result = await pipeline(items, [
  {
    name: "summarize-stage",
    run: async (item, ctx) => {
      const res = await ctx.agent({ definition: "summarizer", text: item });
      return res.stdout;
    }
  }
]);

export default result;
`;
    const workflowPath = path.join(TEMP_DIR, "workflow.js");
    await fs.writeFile(workflowPath, workflow);

    // 3. Create config
    const config = `
defaultProvider: mock
sharedAgents:
  dir: .openflow/agents
providers:
  mock:
    command: mock
`;
    const configPath = path.join(TEMP_DIR, "openflow.config.yaml");
    await fs.writeFile(configPath, config);

    // 4. Run CLI
    const result = await runCli([
      "run",
      workflowPath,
      "--config", configPath,
      "--out", TEMP_DIR,
      "--cwd", TEMP_DIR,
      "--report", "json"
    ]);

    expect(result.error).toBeNull();

    // 5. Verify results
    const runs = (await fs.readdir(TEMP_DIR)).filter(d => d.startsWith("run-") || /^[a-z0-9-]{10,}$/.test(d));
    const runId = (await fs.readdir(TEMP_DIR)).find(d => 
      d !== ".openflow" && d !== "workflow.js" && d !== "openflow.config.yaml" && !d.endsWith(".log")
    )!;
    const runDir = path.join(TEMP_DIR, runId);

    const reportPath = path.join(runDir, "report.json");
    const report = JSON.parse(await fs.readFile(reportPath, "utf8"));

    expect(report.status).toBe("succeeded");
    
    // Check pipeline results
    const pipelineResults = report.result;
    expect(pipelineResults).toHaveLength(2);
    
    // Check first item, first stage
    const item0 = pipelineResults.find((r: any) => r.itemIndex === 0);
    const item0Stage0 = item0.stages[0];
    expect(item0Stage0.status).toBe("succeeded");
    expect(item0Stage0.childAgentIds).toHaveLength(1);
    const agentId = item0Stage0.childAgentIds[0];
    expect(agentId).toContain("pipeline-1-item-0-summarize-stage");

    // Verify agent metadata in report.agents
    const agentResult = report.agents.find((a: any) => a.id === agentId);
    expect(agentResult).toBeDefined();
    expect(agentResult.metadata.sharedAgentId).toBe("summarizer");
    expect(agentResult.metadata.pipelineId).toBe("pipeline-1");
    expect(agentResult.metadata.itemIndex).toBe(0);
    expect(agentResult.metadata.stageName).toBe("summarize-stage");

    // Check prompt artifact for the second item
    const item1 = pipelineResults.find((r: any) => r.itemIndex === 1);
    const item1Stage0 = item1.stages[0];
    const agentId2 = item1Stage0.childAgentIds[0];
    expect(agentId2).toContain("pipeline-1-item-1-summarize-stage");
    
    const agentResult2 = report.agents.find((a: any) => a.id === agentId2);
    expect(agentResult2).toBeDefined();
    
    const promptPath2 = path.join(runDir, agentResult2.artifacts.promptPath);
    const promptContent2 = await fs.readFile(promptPath2, "utf8");
    expect(promptContent2).toBe("Summarize this: item2");

    const promptPath1 = path.join(runDir, agentResult.artifacts.promptPath);
    const promptContent1 = await fs.readFile(promptPath1, "utf8");
    expect(promptContent1).toBe("Summarize this: item1");
  });

  it("converts context validation failures to failed agent results inside a pipeline stage", async () => {
    // 1. Create shared agent definition with schema requiring 'text'
    const agentDef = `
export default defineAgent({
  id: "validated-summarizer",
  description: "test",
  inputSchema: {
    type: "object",
    required: ["text"],
    properties: {
      text: { type: "string" }
    }
  },
  agentPrompt: "Summarize: {{text}}",
  run: async (context, runtime) => {
    return await runtime.agent({
      prompt: runtime.renderAgentPrompt(context),
      provider: "mock"
    });
  }
});
`;
    await fs.writeFile(path.join(TEMP_DIR, ".openflow/agents/validated_summarizer.agent.js"), agentDef);

    // 2. Create workflow with pipeline calling agent with invalid input (missing 'text')
    const workflow = `
export const meta = { name: "pipeline-validation-failure-test", description: "test", version: "0.1.0" };
const items = ["item1"];
const result = await pipeline(items, [
  {
    name: "fail-stage",
    run: async (item, ctx) => {
      // Missing required property 'text'
      const res = await ctx.agent({ definition: "validated-summarizer", incorrect: item });
      return res.stdout;
    }
  }
], { failFast: true });
if (result.some(r => r.status === "failed")) {
  throw new Error("Pipeline failed: " + JSON.stringify(result));
}
export default result;
`;
    const workflowPath = path.join(TEMP_DIR, "workflow-fail.js");
    await fs.writeFile(workflowPath, workflow);

    // 3. Create config
    const config = `
defaultProvider: mock
sharedAgents:
  dir: .openflow/agents
`;
    const configPath = path.join(TEMP_DIR, "openflow.config.yaml");
    await fs.writeFile(configPath, config);

    // 4. Run CLI
    const result = await runCli([
      "run",
      workflowPath,
      "--config", configPath,
      "--out", TEMP_DIR,
      "--cwd", TEMP_DIR,
      "--report", "json"
    ]);

    // 5. Verify failure and report.agents
    const runId = (await fs.readdir(TEMP_DIR)).find(d => 
      d !== ".openflow" && d !== "workflow-fail.js" && d !== "openflow.config.yaml" && !d.endsWith(".log") && d !== "workflow.js"
    )!;
    const runDir = path.join(TEMP_DIR, runId);
    const reportPath = path.join(runDir, "report.json");
    const report = JSON.parse(await fs.readFile(reportPath, "utf8"));

    expect(report.status).toBe("failed");
    
    // Check report.agents contains the failed shared agent
    const failedAgent = report.agents.find((a: any) => a.label === "validated-summarizer");
    expect(failedAgent).toBeDefined();
    expect(failedAgent.ok).toBe(false);
    expect(failedAgent.error.code).toBe("SHARED_AGENT_CONTEXT_VALIDATION_FAILED");
    expect(failedAgent.metadata.pipelineId).toBe("pipeline-1");
    expect(failedAgent.metadata.itemIndex).toBe(0);
    expect(failedAgent.metadata.stageName).toBe("fail-stage");
  });
});
