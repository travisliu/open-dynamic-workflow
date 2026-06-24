import * as fs from "node:fs/promises";
import * as path from "node:path";
import { defineTool } from "@travisliu/open-dynamic-workflow";

function root(storageRoot) {
  const cwd = process.cwd();
  const resolved = path.resolve(cwd, storageRoot || ".ultra-loop");
  if (resolved !== cwd && !resolved.startsWith(cwd + path.sep)) throw new Error("storageRoot must resolve inside the project.");
  return resolved;
}

async function loadPlan(storageRoot, runId) {
  const text = await fs.readFile(path.join(root(storageRoot), "runs", runId, "plan.json"), "utf8");
  return JSON.parse(text);
}

function summarizePlan(plan) {
  const counts = { pending: 0, inProgress: 0, complete: 0, failed: 0, blocked: 0 };
  const criteria = { total: 0, passed: 0, failed: 0, blocked: 0, pending: 0 };
  const blockers = [];
  for (const goal of plan.goals) {
    if (goal.status === "pending") counts.pending += 1;
    if (goal.status === "in_progress") counts.inProgress += 1;
    if (goal.status === "complete") counts.complete += 1;
    if (goal.status === "failed") counts.failed += 1;
    if (goal.status === "blocked" || goal.status === "needs_user_decision") counts.blocked += 1;
    if (goal.blockers) blockers.push(...goal.blockers);
    for (const criterion of goal.successCriteria || []) {
      criteria.total += 1;
      if (criterion.status === "pass") criteria.passed += 1;
      else if (criterion.status === "fail") criteria.failed += 1;
      else if (criterion.status === "blocked") criteria.blocked += 1;
      else criteria.pending += 1;
    }
  }
  return {
    ok: true,
    runId: plan.runId,
    status: plan.aggregateCompletion?.status === "complete" ? "complete" : counts.blocked > 0 ? "blocked" : counts.failed > 0 ? "failed" : "in_progress",
    activeGoal: plan.goals.find(goal => goal.status === "in_progress") || null,
    counts,
    criteria,
    blockers,
    aggregateCompletion: plan.aggregateCompletion || null
  };
}

export default defineTool({
  id: "ultra-loop.status",
  description: "Read durable Ultra Loop run status.",
  inputSchema: {
    type: "object",
    properties: {
      runId: { type: "string" },
      storageRoot: { type: "string" }
    },
    required: ["runId", "storageRoot"]
  },
  outputSchema: { type: "object" },
  run: async (input) => summarizePlan(await loadPlan(input.storageRoot, input.runId))
});
