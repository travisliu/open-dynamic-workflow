import * as fs from "node:fs/promises";
import * as path from "node:path";
import { defineTool } from "@travisliu/open-dynamic-workflow";

function root(storageRoot) {
  const cwd = process.cwd();
  const resolved = path.resolve(cwd, storageRoot || ".ultra-loop");
  if (resolved !== cwd && !resolved.startsWith(cwd + path.sep)) throw new Error("storageRoot must resolve inside the project.");
  return resolved;
}

function runDir(storageRoot, runId) {
  return path.join(root(storageRoot), "runs", runId);
}

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(value, null, 2) + "\n");
}

async function appendLedger(storageRoot, runId, event) {
  const ledgerPath = path.join(runDir(storageRoot, runId), "ledger.jsonl");
  await fs.mkdir(path.dirname(ledgerPath), { recursive: true });
  const existing = await fs.readFile(ledgerPath, "utf8").catch(error => error.code === "ENOENT" ? "" : Promise.reject(error));
  const sequence = existing.trim().length === 0 ? 1 : existing.trim().split("\n").length + 1;
  await fs.appendFile(ledgerPath, JSON.stringify({ sequence, kind: event.kind, ...event }) + "\n");
}

function artifactPaths(storageRoot, runId) {
  const base = path.join(storageRoot, "runs", runId);
  return {
    planPath: path.join(base, "plan.json"),
    ledgerPath: path.join(base, "ledger.jsonl")
  };
}

export default defineTool({
  id: "ultra-loop.create-run",
  description: "Create a durable example Ultra Loop run.",
  inputSchema: {
    type: "object",
    properties: {
      brief: { type: "string" },
      runId: { type: "string" },
      storageRoot: { type: "string" },
      mode: { type: "string", enum: ["aggregate", "per-goal"] },
      seedCriteria: { type: "boolean" }
    },
    required: ["brief", "storageRoot", "mode"]
  },
  outputSchema: { type: "object" },
  run: async (input, context) => {
    const runId = typeof input.runId === "string" && input.runId.length > 0
      ? input.runId
      : `run-${context.runId.slice(0, 8)}`;
    const dir = runDir(input.storageRoot, runId);
    const paths = artifactPaths(input.storageRoot, runId);

    await fs.mkdir(path.join(dir, "evidence"), { recursive: true });
    await fs.mkdir(path.join(dir, "locks"), { recursive: true });
    await fs.mkdir(path.join(dir, "snapshots"), { recursive: true });
    await fs.mkdir(path.join(dir, "quality-gates"), { recursive: true });
    await fs.writeFile(path.join(dir, "brief.md"), input.brief + "\n");

    const plan = {
      runId,
      mode: input.mode,
      status: "in_progress",
      aggregateCompletion: null,
      goals: [
        {
          id: "G001-ultra-loop-brief",
          title: "Satisfy the Ultra Loop brief",
          objective: input.brief,
          attempt: 0,
          status: "pending",
          blockers: [],
          successCriteria: [
            {
              id: "C001-observable-evidence",
              scenario: "The goal has observable, non-empty evidence.",
              userModel: "happy",
              expectedEvidence: "A recorded evidence entry with specific artifacts or observations.",
              essential: true,
              status: "pending",
              evidence: []
            },
            {
              id: "C002-checkpoint-validation",
              scenario: "The Ultra Loop checkpoint accepts goal completion.",
              userModel: "regression",
              expectedEvidence: "A successful goal checkpoint event in the ledger.",
              essential: true,
              status: "pending",
              evidence: []
            }
          ]
        }
      ]
    };

    await writeJson(path.join(dir, "plan.json"), plan);
    await appendLedger(input.storageRoot, runId, {
      kind: "run_created",
      mode: input.mode,
      goalCount: plan.goals.length
    });

    return {
      ok: true,
      runId,
      planPath: paths.planPath,
      ledgerPath: paths.ledgerPath,
      goalCount: plan.goals.length,
      activeGoalId: null
    };
  }
});
