import type { Reporter, ReporterStartInput, ReporterStreams } from "./reporter.js";
import type { EventEnvelope } from "./events.js";
import type { WorkflowRunResult } from "../types/workflow.js";
import { formatUsageSummary } from "./usage.js";

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
          const providerStr = payload.model ? `${payload.provider}/${payload.model}` : payload.provider;
          this.stdout.write(`• ${label} queued [${providerStr}]\n`);
        }
        break;
      }
      case "agent.started": {
        const label = displayAgentLabel(payload);
        const providerStr = this.verbose && payload.model ? `${payload.provider}/${payload.model}` : payload.provider;
        this.stdout.write(`▶ ${label} started [${providerStr}]\n`);
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
        const providerStr = this.verbose && payload.model ? `${payload.provider}/${payload.model}` : payload.provider;
        this.stdout.write(`✓ ${label} succeeded [${providerStr}] ${dur}\n`);
        break;
      }
      case "agent.failed": {
        const label = displayAgentLabel(payload);
        const errMsg = payload.error?.message || "Unknown error";
        const providerStr = this.verbose && payload.model ? `${payload.provider}/${payload.model}` : payload.provider;
        this.stdout.write(`✕ ${label} failed [${providerStr}] ${errMsg}\n`);
        break;
      }
      case "agent.timed_out": {
        const label = displayAgentLabel(payload);
        const errMsg = payload.error?.message || "Timed out";
        const providerStr = this.verbose && payload.model ? `${payload.provider}/${payload.model}` : payload.provider;
        this.stdout.write(`✕ ${label} timed out [${providerStr}] ${errMsg}\n`);
        break;
      }
      case "agent.cancelled": {
        const label = displayAgentLabel(payload);
        const errMsg = payload.error?.message || "Cancelled";
        const providerStr = this.verbose && payload.model ? `${payload.provider}/${payload.model}` : payload.provider;
        this.stdout.write(`✕ ${label} cancelled [${providerStr}] ${errMsg}\n`);
        break;
      }
      case "pipeline.started": {
        const labelText = payload.label ? ` (${payload.label})` : "";
        this.stdout.write(`◇ Pipeline ${payload.pipelineId}${labelText} started [strategy: ${payload.strategy}, items: ${payload.itemCount}]\n`);
        break;
      }
      case "pipeline.stage.started": {
        if (this.verbose) {
          this.stdout.write(`  → Item ${payload.itemIndex}: Stage ${payload.stageName} started\n`);
        }
        break;
      }
      case "pipeline.stage.completed": {
        if (this.verbose) {
          const dur = formatDuration(payload.durationMs);
          this.stdout.write(`  ✓ Item ${payload.itemIndex}: Stage ${payload.stageName} completed ${dur}\n`);
        }
        break;
      }
      case "pipeline.stage.failed": {
        const errMsg = payload.error?.message || "Unknown error";
        this.stdout.write(`  ✕ Item ${payload.itemIndex}: Stage ${payload.stageName} failed: ${errMsg}\n`);
        break;
      }
      case "pipeline.completed":
      case "pipeline.cancelled":
      case "pipeline.failed": {
        const dur = formatDuration(payload.durationMs);
        if (type === "pipeline.completed") {
          this.stdout.write(`✓ Pipeline ${payload.pipelineId} completed successfully ${dur}\n`);
        } else if (type === "pipeline.cancelled") {
          this.stdout.write(`✕ Pipeline ${payload.pipelineId} cancelled ${dur}\n`);
        } else {
          this.stdout.write(`✕ Pipeline ${payload.pipelineId} failed ${dur}\n`);
        }
        if (payload.artifactPath) {
          this.stdout.write(`  Artifacts: ${payload.artifactPath}\n`);
        }
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
      case "workflow.pending": {
        this.stdout.write(`⏸ Workflow pending: ${payload.pause?.id ?? "pause"}\n`);
        if (payload.pause?.message) {
          this.stdout.write(`${payload.pause.message}\n`);
        }
        break;
      }
    }
  }

  finish(result: WorkflowRunResult): void {
    const usage = formatUsageSummary(result.usageSummary);
    if (usage) {
      this.stdout.write(`${usage}\n`);
    }
    if (result.status === "pending" && result.pendingPause) {
      this.stdout.write(`Resume: openflow resume ${result.runId} --pause ${result.pendingPause.id} --input <value>\n`);
    }
    this.stdout.write(`Artifacts: ${result.artifactsDir}\n`);
  }
}
