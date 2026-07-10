import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import { main } from "../../src/cli/index.js";

const TEMP_DIR = path.resolve("tests/temp-provider-alias-events");

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

describe("Integration: Provider Alias Events and Reporter Observability", () => {
  let configPath: string;

  beforeEach(async () => {
    await fs.rm(TEMP_DIR, { recursive: true, force: true });
    await fs.mkdir(TEMP_DIR, { recursive: true });
    await fs.mkdir(path.join(TEMP_DIR, "workflows"), { recursive: true });

    configPath = path.join(TEMP_DIR, "config.yaml");
    const fakeProviderPath = path.resolve("tests/fixtures/providers/fake-provider-cli.mjs");

    // Write config with providers, aliases, and failing provider to test retries
    await fs.writeFile(configPath, `
defaultProvider: alias-gemini
concurrency: 1
timeoutMs: 8000
providers:
  gemini:
    command: node
    args:
      - "${fakeProviderPath}"
    defaultModel: "gemini-alias-model"
    modelArg:
      flag: --model
  failing:
    command: node
    args:
      - "-e"
      - "process.exit(1)"
providerAliases:
  alias-gemini:
    provider: gemini
    model: "gemini-alias-model"
    timeoutMs: 4000
  alias-failing:
    provider: failing
    retry:
      maxAttempts: 2
      delayMs: 10
workflow:
  discovery:
    include:
      - "workflows/**/*.js"
`);

    // Workflow 1: Inherited alias
    await fs.writeFile(path.join(TEMP_DIR, "workflows/inherited.workflow.js"), `
export const meta = { name: "inherited", description: "Inherited alias workflow" };
export default async () => {
  return await agent({
    id: "agent-inherited",
    prompt: "inherited prompt",
    provider: "alias-gemini"
  });
};
`);

    // Workflow 2: Explicit differing agent value (override)
    await fs.writeFile(path.join(TEMP_DIR, "workflows/override.workflow.js"), `
export const meta = { name: "override", description: "Override workflow" };
export default async () => {
  return await agent({
    id: "agent-override",
    prompt: "override prompt",
    provider: "alias-gemini",
    model: "gpt-4"
  });
};
`);

    // Workflow 3: Equal normalized values (no override)
    await fs.writeFile(path.join(TEMP_DIR, "workflows/no-override.workflow.js"), `
export const meta = { name: "no-override", description: "No-override workflow" };
export default async () => {
  return await agent({
    id: "agent-no-override",
    prompt: "no override prompt",
    provider: "alias-gemini",
    model: "gemini-alias-model"
  });
};
`);

    // Workflow 4: Direct concrete provider call
    await fs.writeFile(path.join(TEMP_DIR, "workflows/direct.workflow.js"), `
export const meta = { name: "direct", description: "Direct concrete provider workflow" };
export default async () => {
  return await agent({
    id: "agent-direct",
    prompt: "direct prompt",
    provider: "gemini"
  });
};
`);

    // Workflow 5: Failing agent to test retries and events duplication
    await fs.writeFile(path.join(TEMP_DIR, "workflows/retry.workflow.js"), `
export const meta = { name: "retry", description: "Failing workflow with retries" };
export default async () => {
  try {
    await agent({
      id: "agent-retry",
      prompt: "retry prompt",
      provider: "alias-failing"
    });
  } catch (err) {
    // catch execution error to let workflow succeed overall so we can inspect events easily
    return { ok: false };
  }
};
`);
  });

  afterEach(async () => {
    await fs.rm(TEMP_DIR, { recursive: true, force: true });
  });

  it("proves alias resolution, overrides, direct calls, retries, and formatting requirements", async () => {
    // -------------------------------------------------------------
    // Execute inherited workflow
    // -------------------------------------------------------------
    const resInherited = await runCli([
      "run",
      path.join(TEMP_DIR, "workflows/inherited.workflow.js"),
      "--config", configPath,
      "--out", path.join(TEMP_DIR, "runs-inherited"),
      "--cwd", TEMP_DIR,
      "--report", "jsonl"
    ]);
    expect(resInherited.error).toBeNull();

    const runsInherited = await fs.readdir(path.join(TEMP_DIR, "runs-inherited"));
    const eventsPathInherited = path.join(TEMP_DIR, "runs-inherited", runsInherited[0]!, "events.jsonl");
    const linesInherited = (await fs.readFile(eventsPathInherited, "utf8"))
      .split("\n")
      .filter((l) => l.trim().length > 0)
      .map((l) => JSON.parse(l));

    // Coverage 1: Inherited alias emits one resolution event after selection/validation and before cache_hit, queued, or started
    const resolvedEvent = linesInherited.find((e) => e.type === "agent.provider-alias-resolved");
    const startedEvent = linesInherited.find((e) => e.type === "agent.started");
    const queuedEvent = linesInherited.find((e) => e.type === "agent.queued");

    expect(resolvedEvent).toBeDefined();
    expect(resolvedEvent.payload.providerAlias).toBe("alias-gemini");
    expect(resolvedEvent.payload.provider).toBe("gemini");
    expect(resolvedEvent.payload.requestedProvider).toBe("alias-gemini");
    expect(resolvedEvent.payload.requestedProviderSource).toBe("agent");

    if (queuedEvent) {
      expect(resolvedEvent.sequence).toBeLessThan(queuedEvent.sequence);
    }
    if (startedEvent) {
      expect(resolvedEvent.sequence).toBeLessThan(startedEvent.sequence);
    }

    // -------------------------------------------------------------
    // Execute override workflow
    // -------------------------------------------------------------
    const resOverride = await runCli([
      "run",
      path.join(TEMP_DIR, "workflows/override.workflow.js"),
      "--config", configPath,
      "--out", path.join(TEMP_DIR, "runs-override"),
      "--cwd", TEMP_DIR,
      "--report", "jsonl"
    ]);
    expect(resOverride.error).toBeNull();

    const runsOverride = await fs.readdir(path.join(TEMP_DIR, "runs-override"));
    const eventsPathOverride = path.join(TEMP_DIR, "runs-override", runsOverride[0]!, "events.jsonl");
    const linesOverride = (await fs.readFile(eventsPathOverride, "utf8"))
      .split("\n")
      .filter((l) => l.trim().length > 0)
      .map((l) => JSON.parse(l));

    // Coverage 2: Explicit differing agent value emits expected override payload and source paths
    const overrideEvent = linesOverride.find(
      (e) => e.type === "agent.provider-setting-overridden" && e.payload.setting === "model"
    );
    expect(overrideEvent).toBeDefined();
    expect(overrideEvent!.payload.setting).toBe("model");
    expect(overrideEvent.payload.selectedValue).toBe("gpt-4");
    expect(overrideEvent.payload.selectedSource).toBe("agent");
    expect(overrideEvent.payload.selectedSourcePath).toBe("agent.model");
    expect(overrideEvent.payload.overriddenValue).toBe("gemini-alias-model");
    expect(overrideEvent.payload.overriddenSource).toBe("providerAlias");
    expect(overrideEvent.payload.overriddenSourcePath).toBe("providerAliases.alias-gemini.model");

    // -------------------------------------------------------------
    // Execute no-override workflow
    // -------------------------------------------------------------
    const resNoOverride = await runCli([
      "run",
      path.join(TEMP_DIR, "workflows/no-override.workflow.js"),
      "--config", configPath,
      "--out", path.join(TEMP_DIR, "runs-no-override"),
      "--cwd", TEMP_DIR,
      "--report", "jsonl"
    ]);
    expect(resNoOverride.error).toBeNull();

    const runsNoOverride = await fs.readdir(path.join(TEMP_DIR, "runs-no-override"));
    const eventsPathNoOverride = path.join(TEMP_DIR, "runs-no-override", runsNoOverride[0]!, "events.jsonl");
    const linesNoOverride = (await fs.readFile(eventsPathNoOverride, "utf8"))
      .split("\n")
      .filter((l) => l.trim().length > 0)
      .map((l) => JSON.parse(l));

    // Coverage 3: An agent value equal to the alias value does not emit an
    // agent-over-alias override. The resolver may still report the alias
    // replacing a different lower provider default.
    const overrideNoEvent = linesNoOverride.find(
      (e) => e.type === "agent.provider-setting-overridden" &&
        e.payload.setting === "model" &&
        e.payload.overriddenSource === "providerAlias"
    );
    expect(overrideNoEvent).toBeUndefined();

    // -------------------------------------------------------------
    // Execute direct-provider workflow
    // -------------------------------------------------------------
    const resDirect = await runCli([
      "run",
      path.join(TEMP_DIR, "workflows/direct.workflow.js"),
      "--config", configPath,
      "--out", path.join(TEMP_DIR, "runs-direct"),
      "--cwd", TEMP_DIR,
      "--report", "jsonl"
    ]);
    expect(resDirect.error).toBeNull();

    const runsDirect = await fs.readdir(path.join(TEMP_DIR, "runs-direct"));
    const eventsPathDirect = path.join(TEMP_DIR, "runs-direct", runsDirect[0]!, "events.jsonl");
    const linesDirect = (await fs.readFile(eventsPathDirect, "utf8"))
      .split("\n")
      .filter((l) => l.trim().length > 0)
      .map((l) => JSON.parse(l));

    // Coverage 4: Direct concrete provider call emits no alias-resolution event
    const resolvedDirectEvent = linesDirect.find((e) => e.type === "agent.provider-alias-resolved");
    expect(resolvedDirectEvent).toBeUndefined();

    // -------------------------------------------------------------
    // Execute retry workflow
    // -------------------------------------------------------------
    const resRetry = await runCli([
      "run",
      path.join(TEMP_DIR, "workflows/retry.workflow.js"),
      "--config", configPath,
      "--out", path.join(TEMP_DIR, "runs-retry"),
      "--cwd", TEMP_DIR,
      "--report", "jsonl"
    ]);
    expect(resRetry.error).toBeNull();

    const runsRetry = await fs.readdir(path.join(TEMP_DIR, "runs-retry"));
    const eventsPathRetry = path.join(TEMP_DIR, "runs-retry", runsRetry[0]!, "events.jsonl");
    const linesRetry = (await fs.readFile(eventsPathRetry, "utf8"))
      .split("\n")
      .filter((l) => l.trim().length > 0)
      .map((l) => JSON.parse(l));

    // Coverage 5: Retries do not repeat logical-call resolution events
    const retryResolvedEvents = linesRetry.filter((e) => e.type === "agent.provider-alias-resolved");
    expect(retryResolvedEvents.length).toBe(1);

    // -------------------------------------------------------------
    // Coverage 6: Verify JSONL parsing, sequence numbers, and no secret leak
    // -------------------------------------------------------------
    const allRunsEvents = [linesInherited, linesOverride, linesNoOverride, linesDirect, linesRetry];
    for (const eventsList of allRunsEvents) {
      let lastSeq = -1;
      for (const event of eventsList) {
        expect(event.schemaVersion).toBe("open-dynamic-workflow.event.v1");
        expect(event.runId).toBeDefined();
        expect(event.sequence).toBeGreaterThan(lastSeq);
        lastSeq = event.sequence;

        // Ensure no sensitive provider config, env, or permissions leak into resolution/override payloads
        if (
          event.type === "agent.provider-alias-resolved" ||
          event.type === "agent.provider-setting-overridden"
        ) {
          const payloadStr = JSON.stringify(event.payload);
          expect(payloadStr).not.toContain("secret");
          expect(payloadStr).not.toContain("password");
          expect(payloadStr).not.toContain("token");
          expect(payloadStr).not.toContain("permissions");
          expect(payloadStr).not.toContain("env");
          expect(payloadStr).not.toContain("command");
        }
      }
    }
  });
});
