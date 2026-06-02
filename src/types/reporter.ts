import type { EventEnvelope } from "./events.js";
import type { WorkflowRunResult } from "./workflow.js";

export interface WorkflowRunStart {
  runId: string;
  workflowName: string;
  artifactsDir: string;
  startedAt: string;
}

export interface Reporter {
  start(run: WorkflowRunStart): Promise<void> | void;
  handle(event: EventEnvelope): Promise<void> | void;
  finish(result: WorkflowRunResult): Promise<void> | void;
}
