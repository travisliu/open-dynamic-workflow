import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { main } from "../../src/cli/index.js";

const TEMP_DIR = path.resolve("tests/temp-codex-e2e");
const runIfEnabled = process.env.OPENFLOW_CODEX_E2E === "1" ? it : it.skip;
const execFileAsync = promisify(execFile);

async function runCli(args: string[]) {
  const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

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

  return { error };
}

async function readOnlyRunReport(runRoot: string): Promise<any> {
  const runs = await fs.readdir(runRoot);
  expect(runs).toHaveLength(1);
  const reportPath = path.join(runRoot, runs[0]!, "report.json");
  return JSON.parse(await fs.readFile(reportPath, "utf8"));
}

async function git(cwd: string, args: string[]): Promise<void> {
  await execFileAsync("git", args, { cwd });
}

describe("Codex E2E smoke", () => {
  beforeEach(async () => {
    await fs.rm(TEMP_DIR, { recursive: true, force: true });
    await fs.mkdir(TEMP_DIR, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(TEMP_DIR, { recursive: true, force: true });
  });

  runIfEnabled("runs a minimal real Codex plain-text workflow", async () => {
    const workflowPath = path.join(TEMP_DIR, "plain.workflow.js");
    const runsDir = path.join(TEMP_DIR, "runs-plain");
    await fs.writeFile(workflowPath, `
export const meta = { name: "codex-e2e-plain", description: "Minimal real Codex smoke test" };
const result = await agent("Reply with exactly: openflow-codex-ok", { id: "codex-plain" });
export default result;
`, "utf8");

    const result = await runCli([
      "run",
      workflowPath,
      "--out",
      runsDir,
      "--timeout-ms",
      "240000"
    ]);

    expect(result.error).toBeNull();
    const report = await readOnlyRunReport(runsDir);
    expect(report.status).toBe("succeeded");
    expect(String(report.result).toLowerCase()).toContain("openflow-codex-ok");
  }, 180000);

  runIfEnabled("runs a real Codex schema workflow", async () => {
    const workflowPath = path.join(TEMP_DIR, "schema.workflow.js");
    const runsDir = path.join(TEMP_DIR, "runs-schema");
    await fs.writeFile(workflowPath, `
export const meta = { name: "codex-e2e-schema", description: "Real Codex schema smoke test" };
const result = await agent("Return exactly one JSON object with status ok and exactly two items: alpha and beta.", {
  id: "codex-schema",
  schema: {
    type: "object",
    properties: {
      status: { type: "string" },
      items: {
        type: "array",
        items: { type: "string" },
        minItems: 2,
        maxItems: 2
      }
    },
    required: ["status", "items"]
  },
  structuredOutput: { transport: "auto" }
});
export default result;
`, "utf8");

    const result = await runCli([
      "run",
      workflowPath,
      "--out",
      runsDir,
      "--timeout-ms",
      "240000"
    ]);

    expect(result.error).toBeNull();
    const report = await readOnlyRunReport(runsDir);
    expect(report.status).toBe("succeeded");
    expect(report.result).toEqual({ status: "ok", items: ["alpha", "beta"] });
  }, 240000);

  runIfEnabled("runs a real Codex review workflow", async () => {
    const reviewRepo = path.join(TEMP_DIR, "review-repo");
    await fs.mkdir(reviewRepo, { recursive: true });
    await git(reviewRepo, ["init"]);
    await fs.writeFile(path.join(reviewRepo, "math.js"), "export function add(a, b) { return a + b; }\n", "utf8");
    await git(reviewRepo, ["add", "math.js"]);
    await git(reviewRepo, ["-c", "user.name=OpenFlow Test", "-c", "user.email=openflow@example.test", "commit", "-m", "initial"]);
    await fs.writeFile(path.join(reviewRepo, "math.js"), "export function add(a, b) { return a - b; }\n", "utf8");

    const workflowPath = path.join(TEMP_DIR, "review.workflow.js");
    const runsDir = path.join(TEMP_DIR, "runs-review");
    await fs.writeFile(workflowPath, `
export const meta = { name: "codex-e2e-review", description: "Real Codex review smoke test" };
const review = await agent.review("Review the tiny uncommitted diff. Limit to three bullets.", {
  id: "codex-review",
  cwd: ${JSON.stringify(reviewRepo)},
  uncommitted: true
});
export default review;
`, "utf8");

    const result = await runCli([
      "run",
      workflowPath,
      "--out",
      runsDir,
      "--timeout-ms",
      "240000"
    ]);

    expect(result.error).toBeNull();
    const report = await readOnlyRunReport(runsDir);
    expect(report.status).toBe("succeeded");
    expect(report.agents[0].id).toBe("codex-review");
    expect(typeof report.result).toBe("string");
    expect(report.result.length).toBeGreaterThan(0);
  }, 240000);
});
