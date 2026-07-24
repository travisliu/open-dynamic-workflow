import { describe, expect, it } from "vitest";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { DefaultRuntimeRunner } from "../../src/workflow/runtime.js";
import { FileSystemArtifactStore } from "../../src/artifacts/run-store.js";
import { EventBus } from "../../src/orchestration/event-bus.js";
import type { ParsedWorkflow } from "../../src/types/workflow.js";
import type { ResolvedConfig, CliRunOptions } from "../../src/types/config.js";
import type { AgentResult } from "../../src/types/agent.js";
import type { AgentExecutor, AgentExecutionInput } from "../../src/agents/execution-types.js";

const mockWorkflow = (body: string): ParsedWorkflow => ({
  meta: { name: "integration-workflow", description: "integration test workflow", version: "1.0.0" },
  body,
  sourcePath: "workflow.js",
  sourceText: body,
  sourceHash: "hash-123"
});

class MockAgentExecutor implements AgentExecutor {
  lastPrompt?: string;
  async execute(input: AgentExecutionInput): Promise<AgentResult> {
    this.lastPrompt = input.prompt;
    return {
      ok: true,
      status: "succeeded",
      id: input.id,
      provider: input.provider,
      stdout: "Agent mock response for " + input.prompt,
      stderr: "",
      exitCode: 0,
      durationMs: 5,
      artifacts: { dir: "", promptPath: "", stdoutPath: "", stderrPath: "" },
      permissions: input.permissions
    };
  }
}

describe("Profile Runtime Context Integration", () => {
  it("runs a mock-provider workflow reading profile context before the first agent call, checking events and no-profile run leakage", async () => {
    // Create temporary workspace and output directories
    const tempDir = await fs.mkdtemp(path.join(tmpdir(), "odw-profile-int-"));
    const outDir = path.join(tempDir, "out");
    await fs.mkdir(outDir, { recursive: true });

    const config: ResolvedConfig = {
      defaultProvider: "mock",
      concurrency: 1,
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
      cwd: tempDir,
      outDir,
      cliArgs: {}
    };

    const cli: CliRunOptions = {
      workflowFile: "workflow.js",
      args: {},
      concurrency: 1,
      dryRun: false,
      failFast: false,
      verbose: false
    };

    const body = `
      const mode = context.get("mode");
      const level = context.get("quality.level");
      const name = context.get("$profile.name");
      const source = context.get("$profile.source");
      const hasExternalFile = context.get("$profile.hasExternalFile");
      const hash = context.get("$profile.hash");
      
      const prompt = \`mode=\${mode};level=\${level};name=\${name};source=\${source};hasExternalFile=\${hasExternalFile};hash=\${hash}\`;
      const result = await agent({ id: "agent-1", prompt });
      export default { result, prompt };
    `;

    const profileReport = {
      selected: "my-profile",
      source: "external" as const,
      profilesPath: path.join(tempDir, "profiles.yaml"),
      hash: "abc123hash"
    };

    const profileContextSeed = {
      context: {
        mode: "prod-mode",
        quality: { level: "high" }
      },
      metadata: {
        name: "my-profile",
        source: "external" as const,
        hasExternalFile: true,
        hash: "abc123hash"
      },
      reservedPath: "$profile" as const
    };

    const runner = new DefaultRuntimeRunner();
    const agentExecutor = new MockAgentExecutor();
    const events1: any[] = [];

    const artifactStore1 = new FileSystemArtifactStore({ rootDir: outDir });
    const runId1 = "run-profile-1";
    const eventBus1 = new EventBus({
      runId: runId1,
      artifactStore: artifactStore1,
      subscribers: [{
        handle: (evt) => {
          events1.push(evt);
        }
      }]
    });

    const result1 = await runner.run(
      {
        run: { runId: "test-run", runDir: "/tmp/test-run" },
        parsedWorkflow: mockWorkflow(body),
        config,
        cli,
        profileContextSeed,
        profileReport
      },
      {
        agentExecutor,
        eventSink: eventBus1,
        artifactStore: artifactStore1,
        idGenerator: {
          nextId: (prefix) => {
            if (prefix === "run") return runId1;
            return "id-1";
          }
        }
      }
    );

    expect(result1.status).toBe("succeeded");
    expect(agentExecutor.lastPrompt).toBe("mode=prod-mode;level=high;name=my-profile;source=external;hasExternalFile=true;hash=abc123hash");
    expect(result1.profile).toEqual(profileReport);

    // Verify profile.resolved event emission and monotonic sequence
    await eventBus1.drain();
    const eventTypes1 = events1.map(e => e.type);
    expect(eventTypes1).toContain("profile.resolved");
    expect(eventTypes1).toContain("workflow.started");
    expect(eventTypes1).toContain("agent.started");

    const profileResolvedIdx = eventTypes1.indexOf("profile.resolved");
    const workflowStartedIdx = eventTypes1.indexOf("workflow.started");
    const agentStartedIdx = eventTypes1.indexOf("agent.started");

    // profile.resolved < workflow.started < agent.started
    expect(profileResolvedIdx).toBeLessThan(workflowStartedIdx);
    expect(workflowStartedIdx).toBeLessThan(agentStartedIdx);

    // monotonic sequence
    for (let i = 1; i < events1.length; i++) {
      expect(events1[i].sequence).toBe(events1[i - 1].sequence + 1);
    }

    // Now, run a subsequent no-profile run and assert no leakage
    const body2 = `
      const mode = context.get("mode");
      const name = context.get("$profile.name");
      const prompt = \`mode=\${mode};name=\${name}\`;
      const result = await agent({ id: "agent-1", prompt });
      export default { result, prompt };
    `;

    const events2: any[] = [];
    const runId2 = "run-profile-2";
    const artifactStore2 = new FileSystemArtifactStore({ rootDir: outDir });
    const eventBus2 = new EventBus({
      runId: runId2,
      artifactStore: artifactStore2,
      subscribers: [{
        handle: (evt) => {
          events2.push(evt);
        }
      }]
    });

    const result2 = await runner.run(
      {
        run: { runId: "test-run", runDir: "/tmp/test-run" },
        parsedWorkflow: mockWorkflow(body2),
        config,
        cli
      },
      {
        agentExecutor,
        eventSink: eventBus2,
        artifactStore: artifactStore2,
        idGenerator: {
          nextId: (prefix) => {
            if (prefix === "run") return runId2;
            return "id-2";
          }
        }
      }
    );

    expect(result2.status).toBe("succeeded");
    expect(agentExecutor.lastPrompt).toBe("mode=undefined;name=undefined");
    expect(result2.profile).toBeUndefined();

    await eventBus2.drain();
    const eventTypes2 = events2.map(e => e.type);
    expect(eventTypes2).not.toContain("profile.resolved");

    // Clean up temporary workspace
    await fs.rm(tempDir, { recursive: true, force: true });
  });
});
