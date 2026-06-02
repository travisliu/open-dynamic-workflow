import type { AgentResult, EventEnvelope, WorkflowRunResult } from "../src/types/index.js";

const artifacts = {
  dir: ".execflow/runs/demo/agents/a1",
  promptPath: ".execflow/runs/demo/agents/a1/prompt.txt",
  stdoutPath: ".execflow/runs/demo/agents/a1/stdout.log",
  stderrPath: ".execflow/runs/demo/agents/a1/stderr.log",
  normalizedResultPath: ".execflow/runs/demo/agents/a1/normalized-result.json"
};

const agent: AgentResult = {
  ok: true,
  status: "succeeded",
  id: "a1",
  label: "review-auth",
  provider: "mock",
  text: "mock response",
  stdout: "mock response",
  stderr: "",
  exitCode: 0,
  durationMs: 12,
  artifacts
};

const event: EventEnvelope = {
  schemaVersion: "execflow.event.v1",
  runId: "demo",
  sequence: 1,
  timestamp: new Date(0).toISOString(),
  type: "agent.completed",
  payload: {
    agentId: "a1",
    label: "review-auth",
    provider: "mock",
    status: "succeeded",
    durationMs: 12,
    exitCode: 0,
    artifacts
  }
};

const report: WorkflowRunResult = {
  schemaVersion: "execflow.report.v1",
  runId: "demo",
  status: "succeeded",
  meta: {
    name: "contracts-smoke",
    description: "Verify Phase 0 contract shapes."
  },
  result: { ok: true },
  agents: [agent],
  startedAt: new Date(0).toISOString(),
  finishedAt: new Date(1).toISOString(),
  durationMs: 1,
  artifactsDir: ".execflow/runs/demo",
  reportPath: ".execflow/runs/demo/report.json",
  eventsPath: ".execflow/runs/demo/events.jsonl"
};

console.log(JSON.stringify({ eventType: event.type, reportStatus: report.status }, null, 2));
