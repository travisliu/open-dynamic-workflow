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
  id: "ultra-loop.acquire-next",
  description: "Acquire the active or next pending Ultra Loop goal.",
  inputSchema: {
    type: "object",
    properties: {
      runId: { type: "string" },
      storageRoot: { type: "string" }
    },
    required: ["runId", "storageRoot"]
  },
  outputSchema: { type: "object" },
  run: async (input) => {
    const plan = await loadPlan(input.storageRoot, input.runId);
    let goal = plan.goals.find(item => item.status === "in_progress");

    if (!goal) {
      goal = plan.goals.find(item => item.status === "pending");
      if (goal) {
        goal.status = "in_progress";
        goal.attempt = (goal.attempt || 0) + 1;
        await savePlan(input.storageRoot, plan);
        await appendLedger(input.storageRoot, input.runId, {
          kind: "goal_started",
          goalId: goal.id,
          attempt: goal.attempt
        });
      }
    }

    if (!goal) {
      return {
        ok: true,
        done: true,
        reason: "NO_ELIGIBLE_GOALS"
      };
    }

    return {
      ok: true,
      done: false,
      goal
    };
  }
});
