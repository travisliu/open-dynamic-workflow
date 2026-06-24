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
  id: "ultra-loop.steer",
  description: "Apply an auditable Ultra Loop steering proposal.",
  inputSchema: {
    type: "object",
    properties: {
      runId: { type: "string" },
      storageRoot: { type: "string" },
      idempotencyKey: { type: "string" },
      proposal: { type: "object" }
    },
    required: ["runId", "idempotencyKey", "proposal"]
  },
  outputSchema: { type: "object" },
  run: async (input) => {
    const storageRoot = input.storageRoot || ".ultra-loop";
    const plan = await loadPlan(storageRoot, input.runId);

    plan.steering = [
      ...(plan.steering || []),
      {
        idempotencyKey: input.idempotencyKey,
        proposal: input.proposal
      }
    ];

    await savePlan(storageRoot, plan);
    await appendLedger(storageRoot, input.runId, {
      kind: "steering_accepted",
      idempotencyKey: input.idempotencyKey,
      proposalKind: input.proposal.kind || "unspecified"
    });

    return {
      ok: true,
      accepted: true,
      eventKind: "steering_accepted"
    };
  }
});
