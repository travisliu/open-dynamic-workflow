import type { Reporter, ReporterStartInput, ReporterStreams, ReporterOptions } from "./reporter.js";
import type { EventEnvelope } from "./events.js";
import type { WorkflowRunResult } from "../types/workflow.js";
import { renderVerboseEvent } from "./verbose-formatter.js";
import { PrettyViewBuilder } from "./pretty-view-builder.js";
import { resolveFailedSubpaths } from "./failed-artifacts.js";
import type { PrettyExecutionNode } from "./pretty-view.js";
import { formatDuration, getStatusMarker, formatPermission, formatStatusCounts } from "./pretty-format.js";
import { createPreview } from "../tools/serialization.js";

function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}

function renderNodeLine(node: PrettyExecutionNode, depth: number): string {
  const indent = "  ".repeat(depth + 1);
  const marker = getStatusMarker(node.status);
  const duration = node.durationMs ? formatDuration(node.durationMs) : "";

  switch (node.kind) {
    case "phase": {
      return `${indent}→ ${node.name}`;
    }
    case "workflow": {
      if (node.isRoot) return "";
      return `${indent}${marker} workflow ${node.name}${duration ? "  " + duration : ""}`;
    }
    case "agent": {
      const parts: string[] = [node.label];
      if (node.provider) {
        parts.push(node.provider + (node.model ? "/" + node.model : ""));
      }
      const perm = formatPermission(node.permissions?.mode);
      if (perm) {
        parts.push(perm);
      }
      if (node.status === "failed" || node.status === "timed_out" || node.status === "cancelled") {
        const statusText = node.status === "timed_out" ? "timed out" : node.status === "cancelled" ? "cancelled" : "failed";
        parts.push(`${statusText} after ${duration}`);
      } else if (duration) {
        parts.push(duration);
      }
      return `${indent}${marker} ${parts.join("  ")}`;
    }
    case "tool": {
      const cachePart = node.cached ? " (cache)" : "";
      return `${indent}${marker} ${node.label}${cachePart}${duration ? "  " + duration : ""}`;
    }
    case "pipeline": {
      const label = node.label ? `Pipeline ${node.label}` : "Pipeline";
      return `${indent}${marker} ${label}${duration ? "  " + duration : ""}`;
    }
    case "loop": {
      const parts: string[] = [`loop ${node.label ?? node.id}`];
      if (node.roundCount !== undefined) {
        parts.push(`${node.roundCount}${node.maxRounds ? "/" + node.maxRounds : ""} rounds`);
      }
      if (node.accepted !== undefined) {
        parts.push(node.accepted ? "accepted" : "max rounds");
      }
      if (duration) {
        parts.push(duration);
      }
      return `${indent}${marker} ${parts.join("  ")}`;
    }
    default:
      return "";
  }
}

export class PrettyReporter implements Reporter {
  private readonly stdout: NodeJS.WritableStream;
  private readonly verbose: boolean;
  private readonly builder: PrettyViewBuilder;

  constructor(
    private readonly streams: ReporterStreams,
    private readonly options?: ReporterOptions
  ) {
    this.stdout = streams.stdout;
    this.verbose = !!options?.verbose;
    this.builder = new PrettyViewBuilder();
  }

  start(input: ReporterStartInput): void {
    try {
      this.builder.addStart(input);
      if (!this.verbose) {
        this.stdout.write(`◇ ${input.meta.name}\n`);
        if (input.workflow?.file) {
          this.stdout.write(`  file: ${input.workflow.file}\n`);
        }
        if (input.runId) {
          this.stdout.write(`  run:  ${input.runId}\n`);
        }
        this.stdout.write("\nExecution\n");
      }
    } catch {
      // Best effort
    }
  }

  handle(event: EventEnvelope): void {
    try {
      if (event.type === "workflow.log") {
        const payload = event.payload as any;
        const workflowId = payload.workflowInvocationId;
        const depth = workflowId ? this.builder.getWorkflowLogDepth(workflowId) : 0;
        const indent = "  ".repeat(depth + 1);
        const lines: string[] = [`${indent}• ${payload.message}`];

        if (payload.data !== undefined) {
          const dataIndent = "  ".repeat(depth + 2);
          const dataPreview = createPreview(payload.data);
          const dataText = JSON.stringify(dataPreview, null, 2) ?? String(dataPreview);
          const dataLines = dataText.split("\n");

          if (dataLines.length === 1) {
            lines.push(`${dataIndent}data: ${dataLines[0]}`);
          } else {
            lines.push(`${dataIndent}data:`);
            for (const line of dataLines) {
              lines.push(`${dataIndent}  ${line}`);
            }
          }
        }

        this.stdout.write(lines.join("\n") + "\n");
        return;
      }

      const nodeId = this.builder.addEvent(event);

      if (nodeId) {
        const node = this.builder.getNode(nodeId);
        const depth = this.builder.getNodeDepth(nodeId);
        if (node && depth !== null) {
          const line = renderNodeLine(node, depth);
          if (line) {
            this.stdout.write(line + "\n");
          }
        }
      }

      if (this.verbose) {
        const verboseBlock = renderVerboseEvent(event);
        if (verboseBlock) {
          this.stdout.write(verboseBlock);
        }
      }
    } catch {
      // Best effort
    }
  }

  finish(result: WorkflowRunResult): void {
    try {
      const view = this.builder.build(result);
      
      // Resolve failed subpaths (Developer B's responsibility)
      try {
        if (result.status !== "succeeded" && view.failureRecords.length > 0) {
          view.artifacts.failedSubpaths = resolveFailedSubpaths(
            result.artifactsDir || "",
            view.failureRecords
          );
        }
      } catch {
        // Fallback if resolver fails
      }
      
      this.stdout.write("\nSummary\n");
      const statusLabel = view.summary.status;
      const totalDuration = formatDuration(view.summary.durationMs);
      
      this.stdout.write(`  status:    ${statusLabel}\n`);
      this.stdout.write(`  workflows: ${formatStatusCounts(view.summary.workflowCounts)}\n`);
      this.stdout.write(`  agents:    ${formatStatusCounts(view.summary.agentCounts)}\n`);
      this.stdout.write(`  loops:     ${formatStatusCounts(view.summary.loopCounts)}\n`);
      this.stdout.write(`  duration:  ${totalDuration}\n`);
      if (result.limitSummary?.limits.maxAgentCalls !== undefined) {
        const suffix = result.limitSummary.exceeded ? " exceeded" : "";
        this.stdout.write(
          `  limits:    agent calls ${formatNumber(result.limitSummary.agentCalls)}/${formatNumber(result.limitSummary.limits.maxAgentCalls)}${suffix}\n`
        );
      }
      this.stdout.write("\n");

      this.stdout.write("Artifacts\n");
      if (view.summary.status === "succeeded" && view.artifacts.failedSubpaths.length === 0) {
        this.stdout.write(`  ${view.artifacts.rootDir}\n`);
      } else {
        this.stdout.write(`  run:    ${view.artifacts.rootDir}\n`);
        if (view.artifacts.reportPath) {
          this.stdout.write(`  report: ${view.artifacts.reportPath}\n`);
        }
        if (view.artifacts.eventsPath) {
          this.stdout.write(`  events: ${view.artifacts.eventsPath}\n`);
        }
        if (view.artifacts.failedSubpaths.length > 0) {
          this.stdout.write("  failed:\n");
          for (const subpath of view.artifacts.failedSubpaths) {
            this.stdout.write(`    - ${subpath}\n`);
          }
        }
      }
    } catch (err) {
      // If everything fails, at least print something
      this.stdout.write(`\n✘ Reporter Error: ${err instanceof Error ? err.message : String(err)}\n`);
    }
  }
}
