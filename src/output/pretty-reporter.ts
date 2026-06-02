import type { Reporter, ReporterStartInput, ReporterStreams } from "./reporter.js";
import type { EventEnvelope } from "./events.js";
import type { WorkflowRunResult } from "../types/workflow.js";

function formatDuration(ms?: number): string {
  if (typeof ms !== "number") return "";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function displayAgentLabel(payload: { agentId: string; label?: string }): string {
  return payload.label ?? payload.agentId;
}

export class PrettyReporter implements Reporter {
  private readonly stdout: NodeJS.WritableStream;
  private readonly verbose: boolean;

  constructor(
    private readonly streams: ReporterStreams,
    private readonly options?: { verbose?: boolean }
  ) {
    this.stdout = streams.stdout;
    this.verbose = !!options?.verbose;
  }

  start(input: ReporterStartInput): void {
    const name = input.meta.name;
    this.stdout.write(`◇ ${name}\n`);
  }

  handle(event: EventEnvelope): void {
    const type = event.type;
    const payload = event.payload as any;

    switch (type) {
      case "phase.started": {
        this.stdout.write(`→ Phase: ${payload.name}\n`);
        break;
      }
      case "workflow.log": {
        this.stdout.write(`• ${payload.message}\n`);
        break;
      }
      case "agent.queued": {
        if (this.verbose) {
          const label = displayAgentLabel(payload);
          this.stdout.write(`• ${label} queued [${payload.provider}]\n`);
        }
        break;
      }
      case "agent.started": {
        const label = displayAgentLabel(payload);
        this.stdout.write(`▶ ${label} started [${payload.provider}]\n`);
        break;
      }
      case "agent.output": {
        if (this.verbose) {
          this.stdout.write(`[${payload.agentId}] ${payload.data}`);
        }
        break;
      }
      case "agent.completed": {
        const label = displayAgentLabel(payload);
        const dur = formatDuration(payload.durationMs);
        this.stdout.write(`✓ ${label} succeeded [${payload.provider}] ${dur}\n`);
        break;
      }
      case "agent.failed": {
        const label = displayAgentLabel(payload);
        const errMsg = payload.error?.message || "Unknown error";
        this.stdout.write(`✕ ${label} failed [${payload.provider}] ${errMsg}\n`);
        break;
      }
      case "agent.timed_out": {
        const label = displayAgentLabel(payload);
        const errMsg = payload.error?.message || "Timed out";
        this.stdout.write(`✕ ${label} timed out [${payload.provider}] ${errMsg}\n`);
        break;
      }
      case "agent.cancelled": {
        const label = displayAgentLabel(payload);
        const errMsg = payload.error?.message || "Cancelled";
        this.stdout.write(`✕ ${label} cancelled [${payload.provider}] ${errMsg}\n`);
        break;
      }
      case "workflow.completed": {
        this.stdout.write(`✓ Workflow completed successfully\n`);
        break;
      }
      case "workflow.failed": {
        const errMsg = payload.error?.message || "Unknown error";
        this.stdout.write(`✕ Workflow failed: ${errMsg}\n`);
        break;
      }
    }
  }

  finish(result: WorkflowRunResult): void {
    this.stdout.write(`Artifacts: ${result.artifactsDir}\n`);
  }
}
