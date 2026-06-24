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
  id: "ultra-loop.checkpoint",
  description: "Validate and apply Ultra Loop goal or aggregate checkpoint state.",
  inputSchema: {
    type: "object",
    properties: {
      runId: { type: "string" },
      storageRoot: { type: "string" },
      scope: { type: "string", enum: ["goal", "aggregate"] },
      goalId: { type: "string" },
      status: { type: "string" },
      evidence: { type: "string" },
      snapshot: { type: "object" },
      qualityGateRef: { type: ["string", "null"] }
    },
    required: ["runId", "scope", "status", "evidence"]
  },
  outputSchema: { type: "object" },
  run: async (input) => {
    const storageRoot = input.storageRoot || ".ultra-loop";
    const plan = await loadPlan(storageRoot, input.runId);

    if (input.scope === "goal") {
      const goal = plan.goals.find(item => item.id === input.goalId);
      if (!goal) throw new Error(`Goal '${input.goalId}' was not found.`);

      if (input.status === "complete") {
        const pending = (goal.successCriteria || [])
          .filter(item => item.essential !== false && item.status !== "pass")
          .map(item => item.id);
        if (pending.length > 0) {
          await appendLedger(storageRoot, input.runId, {
            kind: "checkpoint_rejected",
            scope: "goal",
            goalId: goal.id,
            reason: "ULTRA_LOOP_CRITERIA_NOT_ALL_PASS",
            pendingCriteria: pending
          });
          return {
            ok: false,
            accepted: false,
            error: {
              code: "ULTRA_LOOP_CRITERIA_NOT_ALL_PASS",
              message: `Goal ${goal.id} has unresolved success criteria.`,
              details: { pendingCriteria: pending }
            }
          };
        }
      }

      if (input.status === "complete") goal.status = "complete";
      if (input.status === "failed") goal.status = "failed";
      if (input.status === "blocked" || input.status === "needs_user_decision") {
        goal.status = "blocked";
        goal.blockers = [...(goal.blockers || []), input.evidence];
      }

      await savePlan(storageRoot, plan);
      await appendLedger(storageRoot, input.runId, {
        kind: input.status === "complete" ? "goal_completed" : "goal_checkpointed",
        scope: "goal",
        goalId: goal.id,
        status: goal.status
      });

      return {
        ok: true,
        accepted: true,
        status: goal.status,
        eventKind: input.status === "complete" ? "goal_completed" : "goal_checkpointed"
      };
    }

    const unresolved = plan.goals
      .filter(goal => goal.status !== "complete")
      .map(goal => goal.id);
    const gateApproved = plan.qualityGate?.approved === true;

    if (input.status === "complete" && (unresolved.length > 0 || !gateApproved)) {
      await appendLedger(storageRoot, input.runId, {
        kind: "checkpoint_rejected",
        scope: "aggregate",
        reason: "ULTRA_LOOP_AGGREGATE_NOT_READY",
        unresolved,
        gateApproved
      });
      return {
        ok: false,
        accepted: false,
        error: {
          code: "ULTRA_LOOP_AGGREGATE_NOT_READY",
          message: "Aggregate completion requires completed goals and approved quality gate.",
          details: { unresolved, gateApproved }
        }
      };
    }

    plan.aggregateCompletion = {
      status: input.status,
      evidence: input.evidence,
      qualityGateRef: input.qualityGateRef || null
    };
    await savePlan(storageRoot, plan);
    await appendLedger(storageRoot, input.runId, {
      kind: "aggregate_completed",
      scope: "aggregate",
      status: input.status
    });

    return {
      ok: true,
      accepted: true,
      status: input.status,
      eventKind: "aggregate_completed"
    };
  }
});
