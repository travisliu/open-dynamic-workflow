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

export default defineTool({
  id: "ultra-loop.ledger",
  description: "Read or summarize the Ultra Loop ledger.",
  inputSchema: {
    type: "object",
    properties: {
      runId: { type: "string" },
      storageRoot: { type: "string" },
      tail: { type: "number" }
    },
    required: ["runId", "storageRoot"]
  },
  outputSchema: { type: "object" },
  run: async (input) => {
    const ledgerPath = path.join(runDir(input.storageRoot, input.runId), "ledger.jsonl");
    const text = await fs.readFile(ledgerPath, "utf8").catch(error => {
      if (error && error.code === "ENOENT") return "";
      throw error;
    });
    const events = text.trim().length === 0
      ? []
      : text.trim().split("\n").map(line => JSON.parse(line));
    const selected = typeof input.tail === "number" ? events.slice(-input.tail) : events;
    const count = kind => events.filter(event => event.kind === kind).length;

    return {
      ok: true,
      events: selected,
      summary: {
        runCreated: count("run_created") > 0,
        goalsStarted: count("goal_started"),
        evidenceCaptured: count("evidence_captured"),
        checkpointsAccepted: count("goal_completed") + count("aggregate_completed"),
        checkpointsRejected: count("checkpoint_rejected")
      }
    };
  }
});
