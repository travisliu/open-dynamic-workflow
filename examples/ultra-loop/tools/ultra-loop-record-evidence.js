import * as fs from "node:fs/promises";
import * as path from "node:path";
import { defineTool } from "@travisliu/open-dynamic-workflow";

function root(storageRoot) {
  const cwd = process.cwd();
  const resolved = path.resolve(cwd, storageRoot || ".ultra-loop");
  if (resolved !== cwd && !resolved.startsWith(cwd + path.sep)) throw new Error("storageRoot must resolve inside the project.");
  return resolved;
}

function planPath(storageRoot, runId) {
  return path.join(root(storageRoot), "runs", runId, "plan.json");
}

async function loadPlan(storageRoot, runId) {
  return JSON.parse(await fs.readFile(planPath(storageRoot, runId), "utf8"));
}

async function savePlan(storageRoot, plan) {
  await fs.writeFile(planPath(storageRoot, plan.runId), JSON.stringify(plan, null, 2) + "\n");
}

async function appendLedger(storageRoot, runId, event) {
  const ledgerPath = path.join(root(storageRoot), "runs", runId, "ledger.jsonl");
  const existing = await fs.readFile(ledgerPath, "utf8").catch(error => error.code === "ENOENT" ? "" : Promise.reject(error));
  const sequence = existing.trim().length === 0 ? 1 : existing.trim().split("\n").length + 1;
  await fs.appendFile(ledgerPath, JSON.stringify({ sequence, kind: event.kind, ...event }) + "\n");
}

export default defineTool({
  id: "ultra-loop.record-evidence",
  description: "Record evidence for an Ultra Loop success criterion.",
  inputSchema: {
    type: "object",
    properties: {
      runId: { type: "string" },
      storageRoot: { type: "string" },
      goalId: { type: "string" },
      criterionId: { type: "string" },
      status: { type: "string", enum: ["pass", "fail", "blocked"] },
      evidence: { type: "string" },
      artifactRefs: {
        type: "array",
        items: { type: "string" }
      },
      notes: { type: "string" }
    },
    required: ["runId", "goalId", "criterionId", "status", "evidence"]
  },
  outputSchema: { type: "object" },
  run: async (input) => {
    if (input.evidence.trim().length === 0) {
      throw new Error("Evidence must be non-empty.");
    }

    const storageRoot = input.storageRoot || ".ultra-loop";
    const plan = await loadPlan(storageRoot, input.runId);
    const goal = plan.goals.find(item => item.id === input.goalId);
    if (!goal) throw new Error(`Goal '${input.goalId}' was not found.`);

    const criterion = (goal.successCriteria || []).find(item => item.id === input.criterionId);
    if (!criterion) throw new Error(`Criterion '${input.criterionId}' was not found.`);

    criterion.status = input.status;
    criterion.evidence = [
      ...(criterion.evidence || []),
      {
        status: input.status,
        evidence: input.evidence,
        artifactRefs: input.artifactRefs || [],
        notes: input.notes || ""
      }
    ];

    await savePlan(storageRoot, plan);
    await appendLedger(storageRoot, input.runId, {
      kind: "evidence_captured",
      goalId: input.goalId,
      criterionId: input.criterionId,
      criterionStatus: input.status
    });

    return {
      ok: true,
      eventKind: "evidence_captured",
      criterionStatus: input.status
    };
  }
});
