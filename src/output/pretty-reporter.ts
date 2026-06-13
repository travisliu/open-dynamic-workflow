import type { Reporter, ReporterStartInput, ReporterStreams, ReporterOptions } from "./reporter.js";
import type { EventEnvelope } from "./events.js";
import type { WorkflowRunResult } from "../types/workflow.js";
import { sanitizeMetadata } from "../security/metadata.js";
import { renderVerboseEvent } from "./verbose-formatter.js";

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
    private readonly options?: ReporterOptions
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

    // Handle verbose command/result blocks
    if (this.verbose) {
      const verboseBlock = renderVerboseEvent(event);
      if (verboseBlock) {
        this.stdout.write(verboseBlock);
        return;
      }
    }

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
          const permStr = payload.permissions?.mode === "dangerously-full-access" ? " [dangerously-full-access]" : "";
          this.stdout.write(`• ${label} queued [${providerStr}]${permStr}\n`);
          if (payload.metadata && Object.keys(payload.metadata).length > 0) {
            this.stdout.write(`  Metadata: ${JSON.stringify(sanitizeMetadata(payload.metadata))}\n`);
          }
        }
        break;
      }
      case "agent.started": {
        const label = displayAgentLabel(payload);
        const providerStr = this.verbose && payload.model ? `${payload.provider}/${payload.model}` : payload.provider;
        const permStr = payload.permissions?.mode === "dangerously-full-access" ? " [dangerously-full-access]" : "";
        this.stdout.write(`▶ ${label} started [${providerStr}]${permStr}\n`);
        if (this.verbose && payload.metadata && Object.keys(payload.metadata).length > 0) {
          this.stdout.write(`  Metadata: ${JSON.stringify(sanitizeMetadata(payload.metadata))}\n`);
        }
        break;
      }
      case "agent.output": {
        // In verbose mode, we suppress agent.output to avoid interleaving with command/result blocks.
        // It's already rendered in the result block.
        break;
      }
      case "agent.completed": {
        const label = displayAgentLabel(payload);
        const dur = formatDuration(payload.durationMs);
        const providerStr = this.verbose && payload.model ? `${payload.provider}/${payload.model}` : payload.provider;
        const permStr = payload.permissions?.mode === "dangerously-full-access" ? " [dangerously-full-access]" : "";
        this.stdout.write(`✓ ${label} succeeded [${providerStr}] ${dur}${permStr}\n`);
        if (this.verbose && payload.metadata && Object.keys(payload.metadata).length > 0) {
          this.stdout.write(`  Metadata: ${JSON.stringify(sanitizeMetadata(payload.metadata))}\n`);
        }
        break;
      }
      case "agent.cache_hit": {
        const label = displayAgentLabel(payload);
        const providerStr = this.verbose && payload.model ? `${payload.provider}/${payload.model}` : payload.provider;
        this.stdout.write(`↻ ${label} cache hit [${providerStr}]\n`);
        break;
      }
      case "agent.failed": {
        const label = displayAgentLabel(payload);
        const errMsg = payload.error?.message || "Unknown error";
        const providerStr = this.verbose && payload.model ? `${payload.provider}/${payload.model}` : payload.provider;
        const permStr = payload.permissions?.mode === "dangerously-full-access" ? " [dangerously-full-access]" : "";
        this.stdout.write(`✕ ${label} failed [${providerStr}] ${errMsg}${permStr}\n`);
        if (this.verbose && payload.metadata && Object.keys(payload.metadata).length > 0) {
          this.stdout.write(`  Metadata: ${JSON.stringify(sanitizeMetadata(payload.metadata))}\n`);
        }
        break;
      }
      case "agent.timed_out": {
        const label = displayAgentLabel(payload);
        const errMsg = payload.error?.message || "Timed out";
        const providerStr = this.verbose && payload.model ? `${payload.provider}/${payload.model}` : payload.provider;
        const permStr = payload.permissions?.mode === "dangerously-full-access" ? " [dangerously-full-access]" : "";
        this.stdout.write(`✕ ${label} timed out [${providerStr}] ${errMsg}${permStr}\n`);
        if (this.verbose && payload.metadata && Object.keys(payload.metadata).length > 0) {
          this.stdout.write(`  Metadata: ${JSON.stringify(sanitizeMetadata(payload.metadata))}\n`);
        }
        break;
      }
      case "agent.cancelled": {
        const label = displayAgentLabel(payload);
        const providerStr = this.verbose && payload.model ? `${payload.provider}/${payload.model}` : payload.provider;
        const permStr = payload.permissions?.mode === "dangerously-full-access" ? " [dangerously-full-access]" : "";
        this.stdout.write(`• ${label} cancelled [${providerStr}]${permStr}\n`);
        if (this.verbose && payload.metadata && Object.keys(payload.metadata).length > 0) {
          this.stdout.write(`  Metadata: ${JSON.stringify(sanitizeMetadata(payload.metadata))}\n`);
        }
        break;
      }
      case "tool.queued": {
        if (this.verbose) {
          const label = payload.label ?? payload.definition;
          this.stdout.write(`• ${label} tool queued\n`);
        }
        break;
      }
      case "tool.started": {
        if (this.verbose) {
          const label = payload.label ?? payload.definition;
          this.stdout.write(`▶ ${label} tool started\n`);
        }
        break;
      }
      case "tool.completed": {
        const label = payload.label ?? payload.definition;
        const dur = formatDuration(payload.executionDurationMs);
        this.stdout.write(`✓ ${label} tool ${dur}\n`);
        break;
      }
      case "tool.failed": {
        const label = payload.label ?? payload.definition;
        const errMsg = payload.error?.message || "Unknown error";
        this.stdout.write(`✕ ${label} tool failed: ${errMsg}\n`);
        if (payload.artifactPath) {
          this.stdout.write(`  Artifacts: ${payload.artifactPath}\n`);
        }
        break;
      }
      case "tool.timed_out": {
        const label = payload.label ?? payload.definition;
        this.stdout.write(`✕ ${label} tool timed out\n`);
        if (payload.artifactPath) {
          this.stdout.write(`  Artifacts: ${payload.artifactPath}\n`);
        }
        break;
      }
      case "tool.cancelled": {
        if (this.verbose) {
          const label = payload.label ?? payload.definition;
          this.stdout.write(`• ${label} tool cancelled\n`);
        }
        break;
      }
      case "pipeline.started": {
        const labelStr = payload.label ? ` (${payload.label})` : "";
        this.stdout.write(`◇ Pipeline ${payload.pipelineId}${labelStr} started [strategy: ${payload.strategy}, items: ${payload.itemCount}]\n`);
        break;
      }
      case "pipeline.stage.started": {
        this.stdout.write(`  → Item ${payload.itemIndex}: Stage ${payload.stageName} started\n`);
        break;
      }
      case "pipeline.stage.completed": {
        const dur = formatDuration(payload.durationMs);
        this.stdout.write(`  ✓ Item ${payload.itemIndex}: Stage ${payload.stageName} completed ${dur}\n`);
        break;
      }
      case "pipeline.stage.failed": {
        this.stdout.write(`  ✕ Item ${payload.itemIndex}: Stage ${payload.stageName} failed: ${payload.error?.message || "Unknown error"}\n`);
        break;
      }
      case "pipeline.completed": {
        const dur = formatDuration(payload.durationMs);
        this.stdout.write(`✓ Pipeline ${payload.pipelineId} completed successfully ${dur}\n`);
        if (payload.artifactPath) {
          this.stdout.write(`  Artifacts: ${payload.artifactPath}\n`);
        }
        break;
      }
      case "pipeline.failed": {
        this.stdout.write(`✕ Pipeline ${payload.pipelineId} failed\n`);
        break;
      }
      case "workflow.invocation.started": {
        this.stdout.write(`> workflow ${payload.workflowName} started (${payload.workflowInvocationId})\n`);
        break;
      }
      case "workflow.invocation.completed": {
        const dur = formatDuration(payload.durationMs);
        this.stdout.write(`ok workflow ${payload.workflowName} completed in ${dur}\n`);
        break;
      }
      case "workflow.invocation.failed": {
        const dur = formatDuration(payload.durationMs);
        this.stdout.write(`error workflow ${payload.workflowName} failed in ${dur}\n`);
        break;
      }
    }
  }

  finish(result: WorkflowRunResult): void {
    const dur = formatDuration(result.durationMs);
    const artifactsDir = result.artifactsDir;
    if (artifactsDir) {
      this.stdout.write(`Artifacts: ${artifactsDir}\n`);
    }
    if (result.status === "succeeded") {
      this.stdout.write(`✔ Finished in ${dur}\n`);
    } else if (result.status === "cancelled") {
      this.stdout.write(`• Cancelled after ${dur}\n`);
    } else if (result.status === "failed") {
      this.stdout.write(`✘ Failed in ${dur}\n`);
    }
  }
}
