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

function planPath(storageRoot, runId) {
  return path.join(runDir(storageRoot, runId), "plan.json");
}

async function loadPlan(storageRoot, runId) {
  return JSON.parse(await fs.readFile(planPath(storageRoot, runId), "utf8"));
}

async function savePlan(storageRoot, plan) {
  await fs.writeFile(planPath(storageRoot, plan.runId), JSON.stringify(plan, null, 2) + "\n");
}

async function appendLedger(storageRoot, runId, event) {
  const ledgerPath = path.join(runDir(storageRoot, runId), "ledger.jsonl");
  const existing = await fs.readFile(ledgerPath, "utf8").catch(error => error.code === "ENOENT" ? "" : Promise.reject(error));
  const sequence = existing.trim().length === 0 ? 1 : existing.trim().split("\n").length + 1;
  await fs.appendFile(ledgerPath, JSON.stringify({ sequence, kind: event.kind, ...event }) + "\n");
}

export default defineTool({
  id: "ultra-loop.quality-gate",
  description: "Write and validate final Ultra Loop quality gate artifacts.",
  inputSchema: {
    type: "object",
    properties: {
      runId: { type: "string" },
      storageRoot: { type: "string" },
      reports: { type: "object" }
    },
    required: ["runId", "reports"]
  },
  outputSchema: { type: "object" },
  run: async (input) => {
    const storageRoot = input.storageRoot || ".ultra-loop";
    const plan = await loadPlan(storageRoot, input.runId);
    const blockers = [];

    for (const goal of plan.goals) {
      if (goal.status !== "complete") blockers.push(`Goal ${goal.id} is ${goal.status}.`);
    }

    for (const report of Object.values(input.reports || {})) {
      if (report && Array.isArray(report.blockers)) blockers.push(...report.blockers);
      if (report && report.recommendation && report.recommendation !== "approve") {
        blockers.push(`Quality review recommendation: ${report.recommendation}.`);
      }
    }

    const approved = blockers.length === 0;
    const qualityGatePath = path.join(runDir(storageRoot, input.runId), "quality-gates", "gate.json");
    const gate = {
      approved,
      blockers,
      reports: input.reports
    };

    await fs.mkdir(path.dirname(qualityGatePath), { recursive: true });
    await fs.writeFile(qualityGatePath, JSON.stringify(gate, null, 2) + "\n");
    plan.qualityGate = {
      approved,
      qualityGatePath,
      blockers
    };
    await savePlan(storageRoot, plan);
    await appendLedger(storageRoot, input.runId, {
      kind: approved ? "quality_gate_approved" : "quality_gate_rejected",
      approved,
      blockerCount: blockers.length
    });

    return {
      ok: true,
      approved,
      qualityGatePath,
      blockers
    };
  }
});
