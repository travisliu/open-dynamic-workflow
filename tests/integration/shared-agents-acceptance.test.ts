import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { main } from "../../src/cli/index.js";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import { ErrorCode } from "../../src/errors/codes.js";

const TEMP_DIR = path.resolve("tests/temp-acceptance-shared-agent");

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

describe("Shared Agent Acceptance Tests", () => {
  beforeEach(async () => {
    await fs.rm(TEMP_DIR, { recursive: true, force: true });
    await fs.mkdir(TEMP_DIR, { recursive: true });
    await fs.mkdir(path.join(TEMP_DIR, ".open-dynamic-workflow/agents"), { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(TEMP_DIR, { recursive: true, force: true });
  });

  it("Security Validation: rejects shared agent source containing forbidden APIs (e.g., fs.readFileSync)", async () => {
    // Arrange
    const agentDef = `
export default defineAgent({
  id: "malicious-agent",
  description: "tries to read host files",
  run: async (ctx, runtime) => {
    const myFs = require('fs');
    return { data: myFs.readFileSync('/etc/passwd', 'utf8') };
  }
});
`;
    const agentPath = path.join(TEMP_DIR, ".open-dynamic-workflow/agents/malicious.agent.js");
    await fs.writeFile(agentPath, agentDef);

    const workflow = `
export const meta = { name: "test", description: "test" };
await agent({ definition: "malicious-agent" });
`;
    const workflowPath = path.join(TEMP_DIR, "workflow.js");
    await fs.writeFile(workflowPath, workflow);

    const config = `
sharedAgents:
  dir: .open-dynamic-workflow/agents
defaultProvider: mock
`;
    const configPath = path.join(TEMP_DIR, "config.yaml");
    await fs.writeFile(configPath, config);

    // Act
    const result = await runCli([
      "run",
      workflowPath,
      "--config", configPath,
      "--cwd", TEMP_DIR,
      "--report", "json"
    ]);

    // Assert
    expect(result.error).toBeDefined();
    expect(result.error.code).toBe(ErrorCode.SHARED_AGENT_SECURITY_POLICY_VIOLATION);
    expect(result.error.message).toContain("require() is not supported");
  });

  it("Security Validation: rejects shared agent source containing process.env access", async () => {
    // Arrange
    const agentDef = `
export default defineAgent({
  id: "env-agent",
  description: "tries to access process.env",
  run: async (ctx, runtime) => {
    return { env: process.env.SECRET };
  }
});
`;
    const agentPath = path.join(TEMP_DIR, ".open-dynamic-workflow/agents/env.agent.js");
    await fs.writeFile(agentPath, agentDef);

    const workflow = `
export const meta = { name: "test", description: "test" };
await agent({ definition: "env-agent" });
`;
    const workflowPath = path.join(TEMP_DIR, "workflow.js");
    await fs.writeFile(workflowPath, workflow);

    const config = `
sharedAgents:
  dir: .open-dynamic-workflow/agents
defaultProvider: mock
`;
    const configPath = path.join(TEMP_DIR, "config.yaml");
    await fs.writeFile(configPath, config);

    // Act
    const result = await runCli([
      "run",
      workflowPath,
      "--config", configPath,
      "--cwd", TEMP_DIR,
      "--report", "json"
    ]);

    // Assert
    expect(result.error).toBeDefined();
    expect(result.error.code).toBe(ErrorCode.SHARED_AGENT_SECURITY_POLICY_VIOLATION);
    expect(result.error.message).toContain("Access to restricted identifier 'process'");
  });

  it("Security Validation: rejects computed constructor escape in shared agent source", async () => {
    // Arrange
    const agentDef = `
export default defineAgent({
  id: "escape-agent",
  description: "tries to escape sandbox",
  run: async (ctx, runtime) => {
    return { data: {}['con' + 'structor'] };
  }
});
`;
    const agentPath = path.join(TEMP_DIR, ".open-dynamic-workflow/agents/escape.agent.js");
    await fs.writeFile(agentPath, agentDef);

    const workflow = `
export const meta = { name: "test", description: "test" };
await agent({ definition: "escape-agent" });
`;
    const workflowPath = path.join(TEMP_DIR, "workflow.js");
    await fs.writeFile(workflowPath, workflow);

    const config = `
sharedAgents:
  dir: .open-dynamic-workflow/agents
defaultProvider: mock
`;
    const configPath = path.join(TEMP_DIR, "config.yaml");
    await fs.writeFile(configPath, config);

    // Act
    const result = await runCli([
      "run",
      workflowPath,
      "--config", configPath,
      "--cwd", TEMP_DIR,
      "--report", "json"
    ]);

    // Assert
    expect(result.error).toBeDefined();
    expect(result.error.code).toBe(ErrorCode.SHARED_AGENT_SECURITY_POLICY_VIOLATION);
    expect(result.error.message).toContain("Access to restricted property 'constructor' via element access");
  });

  it("Path Containment: rejects symlinks pointing outside the workspace", async () => {
    // Arrange
    const outsideDir = path.resolve(TEMP_DIR, "..", "outside-acceptance-" + Date.now());
    await fs.mkdir(outsideDir, { recursive: true });
    await fs.writeFile(path.join(outsideDir, "outside.yaml"), "id: outside\ndescription: d\nagentPrompt: p");
    
    const symlinkPath = path.join(TEMP_DIR, ".open-dynamic-workflow/agents/outside-link");
    await fs.symlink(outsideDir, symlinkPath, "dir");

    const workflow = `
export const meta = { name: "test", description: "test" };
await agent({ definition: "outside" });
`;
    const workflowPath = path.join(TEMP_DIR, "workflow.js");
    await fs.writeFile(workflowPath, workflow);

    const config = `
sharedAgents:
  dir: .open-dynamic-workflow/agents
defaultProvider: mock
`;
    const configPath = path.join(TEMP_DIR, "config.yaml");
    await fs.writeFile(configPath, config);

    // Act
    try {
        const result = await runCli([
          "run",
          workflowPath,
          "--config", configPath,
          "--cwd", TEMP_DIR,
          "--report", "json"
        ]);

        // Assert
        expect(result.error).toBeDefined();
        expect(result.error.code).toBe(ErrorCode.SHARED_AGENT_SECURITY_POLICY_VIOLATION);
        expect(result.error.message).toContain("points outside the workspace");
    } finally {
        await fs.rm(outsideDir, { recursive: true, force: true });
    }
  });

  it("Dynamic ID Rejection: rejects dynamic variable for shared agent ID", async () => {
    // Arrange
    const workflow = `
export const meta = { name: "test", description: "test" };
const agentId = "my-agent";
await agent({ definition: agentId });
`;
    const workflowPath = path.join(TEMP_DIR, "workflow.js");
    await fs.writeFile(workflowPath, workflow);

    const config = `
sharedAgents:
  allowDynamicIds: false
defaultProvider: mock
`;
    const configPath = path.join(TEMP_DIR, "config.yaml");
    await fs.writeFile(configPath, config);

    // Act
    const result = await runCli([
      "validate",
      workflowPath,
      "--config", configPath,
      "--cwd", TEMP_DIR
    ]);

    // Assert
    expect(result.error).toBeDefined();
    expect(result.error.code).toBe(ErrorCode.WORKFLOW_VALIDATION_ERROR);
    expect(result.error.message).toContain("Shared agent ID must be a string literal");
  });

  it("Metadata Sanitization: redacts sensitive fields and truncates large fields in artifacts and events", async () => {
    // Arrange
    const longLabel = "a".repeat(300);
    const agentDef = `
export default defineAgent({
  id: "metadata-agent",
  description: "test metadata sanitization",
  agentPrompt: "hello",
  metadata: {
    pipelineLabel: "${longLabel}",
    secret: "do-not-leak",
    nested: { token: "do-not-leak" },
    list: ["do-not-leak"]
  },
  run: async (context, runtime) => {
    return await runtime.agent({
      prompt: "hello",
      provider: "mock"
    });
  }
});
`;
    await fs.writeFile(path.join(TEMP_DIR, ".open-dynamic-workflow/agents/metadata.agent.js"), agentDef);

    const workflow = `
export const meta = { name: "metadata-test", description: "test" };
await agent({ definition: "metadata-agent" });
`;
    const workflowPath = path.join(TEMP_DIR, "workflow.js");
    await fs.writeFile(workflowPath, workflow);

    const config = `
sharedAgents:
  dir: .open-dynamic-workflow/agents
defaultProvider: mock
`;
    const configPath = path.join(TEMP_DIR, "config.yaml");
    await fs.writeFile(configPath, config);

    // Act
    const result = await runCli([
      "run",
      workflowPath,
      "--config", configPath,
      "--cwd", TEMP_DIR,
      "--out", TEMP_DIR,
      "--report", "json"
    ]);

    // Assert
    const report = JSON.parse(result.stdout);
    expect(report.status).toBe("succeeded");
    
    const runDir = path.dirname(report.reportPath);
    const agentResult = report.agents[0];
    
    // 1. Check stdout JSON report metadata
    const reportMetadata = agentResult.metadata;
    expect(reportMetadata.sharedAgentId).toBe("metadata-agent");
    expect(reportMetadata.sharedAgentSource).toBe("registry");
    expect(reportMetadata.pipelineLabel).toHaveLength(256 + 3);
    expect(reportMetadata.pipelineLabel).toMatch(/aaa\.\.\.$/);
    expect(reportMetadata.secret).toBeUndefined();
    expect(reportMetadata.nested).toBeUndefined();
    expect(reportMetadata.list).toBeUndefined();

    // 2. Check metadata.json artifact
    const metadataPath = path.join(runDir, agentResult.artifacts.metadataPath);
    const metadataText = await fs.readFile(metadataPath, "utf8");
    const artifactMetadata = JSON.parse(metadataText);
    
    expect(artifactMetadata.sharedAgentId).toBe("metadata-agent");
    expect(artifactMetadata.sharedAgentSource).toBe("registry");
    expect(artifactMetadata.pipelineLabel).toHaveLength(256 + 3);
    expect(artifactMetadata.pipelineLabel).toMatch(/aaa\.\.\.$/);
    expect(artifactMetadata.secret).toBeUndefined();
    expect(artifactMetadata.nested).toBeUndefined();
    expect(artifactMetadata.list).toBeUndefined();

    // 3. Check events.jsonl
    const eventsPath = path.join(runDir, "events.jsonl");
    const eventsText = await fs.readFile(eventsPath, "utf8");
    const events = eventsText.trim().split("\n").map(l => JSON.parse(l));
    const agentCompleted = events.find(e => e.type === "agent.completed");
    expect(agentCompleted).toBeDefined();
    
    const eventMetadata = agentCompleted.payload.metadata;
    expect(eventMetadata.sharedAgentId).toBe("metadata-agent");
    expect(eventMetadata.sharedAgentSource).toBe("registry");
    expect(eventMetadata.pipelineLabel).toHaveLength(256 + 3);
    expect(eventMetadata.pipelineLabel).toMatch(/aaa\.\.\.$/);
    expect(eventMetadata.secret).toBeUndefined();
    expect(eventMetadata.nested).toBeUndefined();
    expect(eventMetadata.list).toBeUndefined();

    // 4. Raw content checks for sentinel absence
    expect(result.stdout).not.toContain("do-not-leak");
    expect(eventsText).not.toContain("do-not-leak");
    expect(metadataText).not.toContain("do-not-leak");

    // Ensure NO non-allowlisted keys leaked at all
    const safeFields = [
      "sharedAgentId", "sharedAgentSource", "pipelineId", "pipelineLabel", 
      "itemIndex", "stageIndex", "stageName", "modelResolutionSource",
      "model", "resolutionSource", "structuredOutputTransport", "permissions",
      "thinkingEffort", "thinkingEffortResolutionSource"
    ];
    for (const key of Object.keys(reportMetadata)) {
      expect(safeFields).toContain(key);
    }
    for (const key of Object.keys(artifactMetadata)) {
      expect(safeFields).toContain(key);
    }
    for (const key of Object.keys(eventMetadata)) {
      expect(safeFields).toContain(key);
    }
  });

  it("Documentation Verification: verifies configuration and cli-commands references contain shared-agent details", async () => {
    // Arrange & Act
    const configDoc = await fs.readFile("skills/open-dynamic-workflow/references/configuration.md", "utf8");
    const cliDoc = await fs.readFile("skills/open-dynamic-workflow/references/cli-commands.md", "utf8");

    // Assert
    expect(configDoc).toContain("sharedAgents");
    expect(configDoc).toContain("allowDynamicIds");
    expect(configDoc).toContain("rejected for security");
    
    expect(cliDoc).toContain("Shared Agent Loading");
    expect(cliDoc).toContain("SHARED_AGENT_SECURITY_POLICY_VIOLATION");
  });

});
