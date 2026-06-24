import type { PrettyRunView, PrettyExecutionNode } from "./pretty-view.js";
import { formatDuration, getStatusMarker, formatPermission, formatStatusCounts } from "./pretty-format.js";

export function renderPrettyView(view: PrettyRunView): string {
  const lines: string[] = [];

  // 1. Header
  lines.push(`◇ ${view.header.name}`);
  if (view.header.workflowFile) {
    lines.push(`  file: ${view.header.workflowFile}`);
  }
  if (view.header.runId) {
    lines.push(`  run:  ${view.header.runId}`);
  }
  lines.push("");

  // 2. Execution
  lines.push("Execution");
  renderExecutionNodes(view.execution, 0, lines);
  lines.push("");

  // 3. Summary
  lines.push("Summary");
  const statusLabel = view.summary.status;
  const totalDuration = formatDuration(view.summary.durationMs);
  
  lines.push(`  status:    ${statusLabel}`);
  lines.push(`  workflows: ${formatStatusCounts(view.summary.workflowCounts)}`);
  lines.push(`  agents:    ${formatStatusCounts(view.summary.agentCounts)}`);
  lines.push(`  loops:     ${formatStatusCounts(view.summary.loopCounts)}`);
  lines.push(`  duration:  ${totalDuration}`);
  lines.push("");

  // 4. Artifacts
  lines.push("Artifacts");
  if (view.summary.status === "succeeded" && view.artifacts.failedSubpaths.length === 0) {
    lines.push(`  ${view.artifacts.rootDir}`);
  } else {
    lines.push(`  run:    ${view.artifacts.rootDir}`);
    if (view.artifacts.reportPath) {
      lines.push(`  report: ${view.artifacts.reportPath}`);
    }
    if (view.artifacts.eventsPath) {
      lines.push(`  events: ${view.artifacts.eventsPath}`);
    }
    if (view.artifacts.failedSubpaths.length > 0) {
      lines.push("  failed:");
      for (const subpath of view.artifacts.failedSubpaths) {
        lines.push(`    - ${subpath}`);
      }
    }
  }

  return lines.join("\n") + "\n";
}

function renderExecutionNodes(nodes: PrettyExecutionNode[], depth: number, lines: string[]): void {
  const indent = "  ".repeat(depth + 1);
  
  for (const node of nodes) {
    const marker = getStatusMarker(node.status);
    const duration = node.durationMs ? formatDuration(node.durationMs) : "";

    switch (node.kind) {
      case "phase": {
        lines.push(`${indent}→ ${node.name}`);
        renderExecutionNodes(node.children ?? [], depth + 1, lines);
        break;
      }
      case "workflow": {
        if (!node.isRoot) {
          lines.push(`${indent}${marker} workflow ${node.name}${duration ? "  " + duration : ""}`);
        }
        renderExecutionNodes(node.children, node.isRoot ? depth : depth + 1, lines);
        break;
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
        lines.push(`${indent}${marker} ${parts.join("  ")}`);
        break;
      }
      case "tool": {
        const cachePart = node.cached ? " (cache)" : "";
        lines.push(`${indent}${marker} ${node.label}${cachePart}${duration ? "  " + duration : ""}`);
        break;
      }
      case "pipeline": {
        const label = node.label ? `Pipeline ${node.label}` : "Pipeline";
        lines.push(`${indent}${marker} ${label}${duration ? "  " + duration : ""}`);
        break;
      }
      case "loop": {
        const parts: string[] = [`loop ${node.label ?? node.id}`];
        if (node.roundCount !== undefined) {
          parts.push(`${node.roundCount}${node.maxRounds ? "/" + node.maxRounds : ""} rounds`);
        }
        if (node.reason) {
          parts.push(node.reason);
        }
        if (duration) {
          parts.push(duration);
        }
        lines.push(`${indent}${marker} ${parts.join("  ")}`);
        renderExecutionNodes(node.children ?? [], depth + 1, lines);
        break;
      }
    }
  }
}
