import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { main } from "../../src/cli/index.js";
import * as path from "node:path";
import * as fs from "node:fs/promises";

const TEMP_DIR = path.resolve("tests/temp-shared-agent");

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

describe("Shared Agent Workflow Integration", () => {
  beforeEach(async () => {
    await fs.rm(TEMP_DIR, { recursive: true, force: true });
    await fs.mkdir(TEMP_DIR, { recursive: true });
    await fs.mkdir(path.join(TEMP_DIR, ".openflow/agents"), { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(TEMP_DIR, { recursive: true, force: true });
  });

  it("runs a workflow calling a shared agent", async () => {
    // 1. Create shared agent definition
    const agentDef = `
export default defineAgent({
  id: "security-review",
  description: "Review files for security",
  inputSchema: {
    type: "object",
    properties: {
      prompt: { type: "string" }
    }
  },
  agentPrompt: "Security review requested: {{prompt}}",
  run: async (context, runtime) => {
    return await runtime.agent({
      prompt: runtime.renderAgentPrompt(context),
      provider: "mock"
    });
  }
});
`;
    await fs.writeFile(path.join(TEMP_DIR, ".openflow/agents/security.agent.js"), agentDef);

    // 2. Create workflow
    const workflow = `
export const meta = { name: "shared-agent-test", description: "test", version: "0.1.0" };
const res = await agent({ definition: "security-review", prompt: "check auth" });
export default res;
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

    if (result.error) {
      console.error("CLI error:", result.error);
    }
    expect(result.error).toBeNull();

    // 5. Verify results
    const runs = (await fs.readdir(TEMP_DIR)).filter(d => d !== ".openflow" && d !== "workflow.js" && d !== "openflow.config.yaml");
    expect(runs.length).toBe(1);
    const runId = runs[0]!;
    const runDir = path.join(TEMP_DIR, runId);

    const reportPath = path.join(runDir, "report.json");
    const report = JSON.parse(await fs.readFile(reportPath, "utf8"));
    if (report.agents.length === 0) {
      console.log("Full report:", JSON.stringify(report, null, 2));
    }

    expect(report.status).toBe("succeeded");
    expect(report.agents.length).toBe(1);
    
    const agentResult = report.agents[0];
    expect(agentResult.label).toBe("security-review");
    expect(agentResult.metadata.sharedAgentId).toBe("security-review");
    expect(agentResult.metadata.sharedAgentSource).toBe("registry");

    // Check prompt artifact
    const promptPath = path.join(runDir, agentResult.artifacts.promptPath);
    const promptContent = await fs.readFile(promptPath, "utf8");
    expect(promptContent).toBe("Security review requested: check auth");
  });

  it("fails when shared agent context validation fails (SHARED_AGENT_CONTEXT_VALIDATION_FAILED)", async () => {
    // 1. Create shared agent with schema
    const agentDef = `
export default defineAgent({
  id: "validated-agent",
  description: "test",
  inputSchema: {
    type: "object",
    required: ["foo"],
    properties: {
      foo: { type: "string" }
    }
  },
  agentPrompt: "Foo: {{foo}}",
  run: async (context, runtime) => {
    return await runtime.agent({
      prompt: runtime.renderAgentPrompt(context),
      provider: "mock"
    });
  }
});
`;
    await fs.writeFile(path.join(TEMP_DIR, ".openflow/agents/validated.agent.js"), agentDef);

    // 2. Create workflow with invalid context (missing 'foo')
    const workflow = `
export const meta = { name: "invalid-context", description: "test" };
const input = { bar: "baz" };
await agent({ definition: "validated-agent", ...input });
`;
    const workflowPath = path.join(TEMP_DIR, "workflow-invalid.js");
    await fs.writeFile(workflowPath, workflow);

    // 3. Create config
    const config = `
defaultProvider: mock
sharedAgents:
  dir: .openflow/agents
`;
    const configPath = path.join(TEMP_DIR, "config.yaml");
    await fs.writeFile(configPath, config);

    // 4. Run CLI
    const result = await runCli([
      "run",
      workflowPath,
      "--config", configPath,
      "--cwd", TEMP_DIR,
      "--report", "json"
    ]);

    // 5. Verify failure
    const report = JSON.parse(result.stdout);
    expect(report.status).toBe("failed");
    expect(report.error.code).toBe("SHARED_AGENT_CONTEXT_VALIDATION_FAILED");
    expect(report.error.message).toContain("must have required property 'foo'");

    expect(report.agents.length).toBe(1);
    expect(report.agents[0].ok).toBe(false);
    expect(report.agents[0].label).toBe("validated-agent");
    expect(report.agents[0].error.code).toBe("SHARED_AGENT_CONTEXT_VALIDATION_FAILED");
  });

  it("fails when shared agent is not found (validation error)", async () => {
    // Use literal ID that doesn't exist to trigger validation error
    const workflow = `
export const meta = { name: "missing-agent", description: "test" };
await agent({ definition: "non-existent" });
`;
    const workflowPath = path.join(TEMP_DIR, "workflow-missing.js");
    await fs.writeFile(workflowPath, workflow);

    const config = `defaultProvider: mock`;
    const configPath = path.join(TEMP_DIR, "config.yaml");
    await fs.writeFile(configPath, config);

    const result = await runCli([
      "run",
      workflowPath,
      "--config", configPath,
      "--cwd", TEMP_DIR,
      "--report", "json"
    ]);

    expect(result.error).toBeDefined();
    expect(result.error.code).toBe("WORKFLOW_VALIDATION_ERROR");
    expect(result.error.message).toContain("Shared agent 'non-existent' was not found");
  });

  it("fails when dynamic ID is used and allowDynamicIds is false", async () => {
    const workflow = `
export const meta = { name: "dynamic-id", description: "test" };
const id = "some-agent";
await agent({ definition: id });
`;
    const workflowPath = path.join(TEMP_DIR, "workflow-dynamic.js");
    await fs.writeFile(workflowPath, workflow);

    const config = `
defaultProvider: mock
sharedAgents:
  allowDynamicIds: false
`;
    const configPath = path.join(TEMP_DIR, "config.yaml");
    await fs.writeFile(configPath, config);

    const result = await runCli([
      "run",
      workflowPath,
      "--config", configPath,
      "--cwd", TEMP_DIR,
      "--report", "json"
    ]);

    expect(result.error).toBeDefined();
    expect(result.error.code).toBe("WORKFLOW_VALIDATION_ERROR");
    expect(result.error.message).toContain("Shared agent ID must be a string literal.");
  });

  it("fails when dynamic ID is used via ctx.agent and allowDynamicIds is false", async () => {
    const workflow = `
export const meta = { name: "dynamic-id-ctx", description: "test" };
export default async (ctx) => {
  const id = "some-agent";
  await ctx.agent({ definition: id });
};
`;
    const workflowPath = path.join(TEMP_DIR, "workflow-dynamic-ctx.js");
    await fs.writeFile(workflowPath, workflow);

    const config = `
defaultProvider: mock
sharedAgents:
  allowDynamicIds: false
`;
    const configPath = path.join(TEMP_DIR, "config.yaml");
    await fs.writeFile(configPath, config);

    const result = await runCli([
      "run",
      workflowPath,
      "--config", configPath,
      "--cwd", TEMP_DIR,
      "--report", "json"
    ]);

    expect(result.error).toBeDefined();
    expect(result.error.code).toBe("WORKFLOW_VALIDATION_ERROR");
    expect(result.error.message).toContain("Shared agent ID must be a string literal.");
  });

  it("produces shared-agent metadata in JSONL report", async () => {
    // 1. Setup agent
    const agentDef = `
export default defineAgent({
  id: "test-agent",
  description: "test",
  agentPrompt: "test",
  run: async (context, runtime) => {
    return await runtime.agent({
      prompt: "test",
      provider: "mock"
    });
  }
});
`;
    await fs.writeFile(path.join(TEMP_DIR, ".openflow/agents/test.agent.js"), agentDef);

    // 2. Setup workflow
    const workflow = `
export const meta = { name: "jsonl-test", description: "test" };
await agent({ definition: "test-agent" });
`;
    const workflowPath = path.join(TEMP_DIR, "workflow-jsonl.js");
    await fs.writeFile(workflowPath, workflow);

    // 3. Setup config
    const config = `
sharedAgents:
  dir: .openflow/agents
defaultProvider: mock
`;
    const configPath = path.join(TEMP_DIR, "config.yaml");
    await fs.writeFile(configPath, config);

    // 4. Run CLI with jsonl report
    await runCli([
      "run",
      workflowPath,
      "--config", configPath,
      "--cwd", TEMP_DIR,
      "--report", "jsonl",
      "--out", TEMP_DIR
    ]);

    // 5. Verify JSONL
    const runs = (await fs.readdir(TEMP_DIR)).filter(d => /^[a-z0-9-]{10,}$/.test(d));
    const runDir = path.join(TEMP_DIR, runs[0]!);
    const eventsPath = path.join(runDir, "events.jsonl");
    const eventsContent = await fs.readFile(eventsPath, "utf8");
    const events = eventsContent.trim().split("\n").map(line => JSON.parse(line));

    // Find agent completed event
    const agentCompleted = events.find(e => e.type === "agent.completed");
    expect(agentCompleted).toBeDefined();
    expect(agentCompleted.payload.metadata.sharedAgentId).toBe("test-agent");
  });

  it("displays shared-agent metadata in pretty reporter verbose output", async () => {
    // 1. Setup agent
    const agentDef = `
export default defineAgent({
  id: "pretty-agent",
  description: "test",
  agentPrompt: "test",
  run: async (context, runtime) => {
    return await runtime.agent({
      prompt: "test",
      provider: "mock"
    });
  }
});
`;
    await fs.writeFile(path.join(TEMP_DIR, ".openflow/agents/pretty.agent.js"), agentDef);

    // 2. Setup workflow
    const workflow = `
export const meta = { name: "pretty-test", description: "test" };
await agent({ definition: "pretty-agent" });
`;
    const workflowPath = path.join(TEMP_DIR, "workflow-pretty.js");
    await fs.writeFile(workflowPath, workflow);

    // 3. Setup config
    const config = `
sharedAgents:
  dir: .openflow/agents
defaultProvider: mock
reporting:
  mode: pretty
  verbose: true
`;
    const configPath = path.join(TEMP_DIR, "config-pretty.yaml");
    await fs.writeFile(configPath, config);

    // 4. Run CLI
    const result = await runCli([
      "run",
      workflowPath,
      "--config", configPath,
      "--cwd", TEMP_DIR,
      "--verbose"
    ]);

    // 5. Verify output contains metadata
    expect(result.stdout).toContain('"sharedAgentId":"pretty-agent"');
    expect(result.stdout).toContain('"sharedAgentSource":"registry"');
    expect(result.stdout).toContain("✓ pretty-agent succeeded");
  });

  it("fails openflow run before execution when registry contains an invalid definition schema", async () => {
    // 1. Create a shared agent with invalid inputSchema
    const agentDef = `
export default defineAgent({
  id: "bad-schema-agent",
  description: "test",
  inputSchema: {
    type: 123
  },
  agentPrompt: "test",
  run: async (context, runtime) => {
    return await runtime.agent({
      prompt: "test",
      provider: "mock"
    });
  }
});
`;
    await fs.writeFile(path.join(TEMP_DIR, ".openflow/agents/bad-schema.agent.js"), agentDef);

    // 2. Create workflow
    const workflow = `
export const meta = { name: "test-workflow", description: "test" };
await agent({ definition: "bad-schema-agent" });
`;
    const workflowPath = path.join(TEMP_DIR, "workflow-bad-schema.js");
    await fs.writeFile(workflowPath, workflow);

    // 3. Create config
    const config = `
sharedAgents:
  dir: .openflow/agents
defaultProvider: mock
`;
    const configPath = path.join(TEMP_DIR, "config.yaml");
    await fs.writeFile(configPath, config);

    // 4. Run CLI
    const result = await runCli([
      "run",
      workflowPath,
      "--config", configPath,
      "--cwd", TEMP_DIR,
      "--report", "json"
    ]);

    // 5. Verify it failed before execution with SHARED_AGENT_INVALID_DEFINITION
    expect(result.error).toBeDefined();
    expect(result.error.code).toBe("SHARED_AGENT_INVALID_DEFINITION");
  });

  describe("openflow validate integration", () => {
    it("validates a valid literal definition reference successfully", async () => {
      const agentDef = `
export default defineAgent({
  id: "valid-agent",
  description: "A valid agent",
  inputSchema: {
    type: "object",
    properties: {
      prompt: { type: "string" }
    }
  },
  agentPrompt: "Hello",
  run: async (context, runtime) => {
    return await runtime.agent({
      prompt: "Hello",
      provider: "mock"
    });
  }
});
`;
      await fs.writeFile(path.join(TEMP_DIR, ".openflow/agents/valid.agent.js"), agentDef);

      const workflow = `
export const meta = { name: "test", description: "test" };
await agent({ definition: "valid-agent", prompt: "world" });
`;
      const workflowPath = path.join(TEMP_DIR, "workflow.js");
      await fs.writeFile(workflowPath, workflow);

      const config = `
sharedAgents:
  dir: .openflow/agents
`;
      const configPath = path.join(TEMP_DIR, "config.yaml");
      await fs.writeFile(configPath, config);

      const result = await runCli([
        "validate",
        workflowPath,
        "--config", configPath,
        "--cwd", TEMP_DIR
      ]);

      expect(result.error).toBeNull();
      expect(result.stdout).toContain("Workflow is valid: test");
    });

    it("flags a missing definition during validation", async () => {
      const workflow = `
export const meta = { name: "test", description: "test" };
await agent({ definition: "missing-agent", prompt: "world" });
`;
      const workflowPath = path.join(TEMP_DIR, "workflow.js");
      await fs.writeFile(workflowPath, workflow);

      const config = `
sharedAgents:
  dir: .openflow/agents
`;
      const configPath = path.join(TEMP_DIR, "config.yaml");
      await fs.writeFile(configPath, config);

      const result = await runCli([
        "validate",
        workflowPath,
        "--config", configPath,
        "--cwd", TEMP_DIR
      ]);

      expect(result.error).toBeDefined();
      expect(result.error.message).toContain("was not found in the configured registry");
    });

    it("flags a missing definition when the shared-agent directory is missing", async () => {
      const workflow = `
export const meta = { name: "test", description: "test" };
await agent({ definition: "some-agent", prompt: "world" });
`;
      const workflowPath = path.join(TEMP_DIR, "workflow.js");
      await fs.writeFile(workflowPath, workflow);

      const config = `
sharedAgents:
  dir: nonexistent-directory
`;
      const configPath = path.join(TEMP_DIR, "config.yaml");
      await fs.writeFile(configPath, config);

      const result = await runCli([
        "validate",
        workflowPath,
        "--config", configPath,
        "--cwd", TEMP_DIR
      ]);

      expect(result.error).toBeDefined();
      expect(result.error.message).toContain("was not found in the configured registry");
    });

    it("flags an invalid shared-agent file with non-string description", async () => {
      const agentDef = `
export default defineAgent({
  id: "invalid-agent",
  description: 123,
  agentPrompt: "hello",
  run: async (context, runtime) => {
    return await runtime.agent({
      prompt: "hello",
      provider: "mock"
    });
  }
});
`;
      await fs.writeFile(path.join(TEMP_DIR, ".openflow/agents/invalid.agent.js"), agentDef);

      const workflow = `
export const meta = { name: "test", description: "test" };
await agent({ definition: "invalid-agent" });
`;
      const workflowPath = path.join(TEMP_DIR, "workflow.js");
      await fs.writeFile(workflowPath, workflow);

      const config = `
sharedAgents:
  dir: .openflow/agents
`;
      const configPath = path.join(TEMP_DIR, "config.yaml");
      await fs.writeFile(configPath, config);

      const result = await runCli([
        "validate",
        workflowPath,
        "--config", configPath,
        "--cwd", TEMP_DIR
      ]);

      expect(result.error).toBeDefined();
      expect(result.error.code).toBe("SHARED_AGENT_INVALID_DEFINITION");
    });

    it("runs a workflow calling a TS shared agent", async () => {
      const agentDef = `
import { defineAgent } from "../../src/shared-agents/define-agent.js";
export default defineAgent({
  id: "security-review-ts",
  description: "Review files for security (TS version)",
  inputSchema: {
    type: "object",
    properties: {
      prompt: { type: "string" }
    }
  },
  agentPrompt: "Security review requested (TS): {{prompt}}",
  run: async (context, runtime) => {
    return await runtime.agent({
      prompt: runtime.renderAgentPrompt(context),
      provider: "mock"
    });
  }
});
`;
      await fs.writeFile(path.join(TEMP_DIR, ".openflow/agents/security.agent.ts"), agentDef);

      const workflow = `
export const meta = { name: "shared-agent-ts-test", description: "test", version: "0.1.0" };
const res = await agent({ definition: "security-review-ts", prompt: "check auth ts" });
export default res;
`;
      const workflowPath = path.join(TEMP_DIR, "workflow-ts.js");
      await fs.writeFile(workflowPath, workflow);

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

      const result = await runCli([
        "run",
        workflowPath,
        "--config", configPath,
        "--cwd", TEMP_DIR,
        "--report", "json"
      ]);

      expect(result.error).toBeNull();
      const report = JSON.parse(result.stdout);
      expect(report.status).toBe("succeeded");
      expect(report.agents).toHaveLength(1);
      
      const agentResult = report.agents[0];
      expect(agentResult.metadata.sharedAgentId).toBe("security-review-ts");
    });
  });
});
