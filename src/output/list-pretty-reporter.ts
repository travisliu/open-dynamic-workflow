import type { ListResult, ListedResource, ListResourceType, ListDiagnostic } from "../discovery/types.js";
import type { ListReporter, ListReporterStreams } from "./list-reporter.js";

export class ListPrettyReporter implements ListReporter {
  constructor(private streams: ListReporterStreams, private verbose: boolean) {}

  render(result: ListResult): void {
    const { resourceTypes } = result;

    if (resourceTypes.length === 1) {
      const type = resourceTypes[0];
      if (type) {
        this.renderTargeted(result, type);
      }
    } else {
      this.renderAll(result);
    }

    this.renderDiagnosticsAndHints(result);
  }

  private renderDiagnosticsAndHints(result: ListResult): void {
    if (this.isUninitializedDefaultProject(result)) {
      const allDiags = [...result.warnings, ...result.errors];
      const initDiag = allDiags.find((d) => d.hint?.code === "PROJECT_INIT_MISSING");
      const command = initDiag?.hint?.command ?? "odw init";

      this.streams.stdout.write(`\nWarnings:\n`);
      this.streams.stdout.write(`  - Project is not initialized.\n`);
      this.streams.stdout.write(`    Missing config: .open-dynamic-workflow/config.yaml\n`);
      this.streams.stdout.write(`    Missing directories:\n`);
      this.streams.stdout.write(`      - workflows\n`);
      this.streams.stdout.write(`      - .open-dynamic-workflow/agents\n`);
      this.streams.stdout.write(`      - .open-dynamic-workflow/tools\n`);
      this.streams.stdout.write(`\nNext step:\n`);
      this.streams.stdout.write(`  Run \`${command}\` to initialize this project.\n`);
      return;
    }

    this.renderDiagnostics(result.warnings, "Warnings");
    this.renderDiagnostics(result.errors, "Errors");
  }

  private isUninitializedDefaultProject(result: ListResult): boolean {
    const { resourceTypes, resources, warnings, errors } = result;

    if (
      resourceTypes.length !== 3 ||
      !resourceTypes.includes("workflow") ||
      !resourceTypes.includes("agent") ||
      !resourceTypes.includes("tool")
    ) {
      return false;
    }

    if (resources.length !== 0) {
      return false;
    }

    const allDiags = [...warnings, ...errors];
    if (allDiags.length !== 3) {
      return false;
    }

    const isDefaultWorkflowPath = (p: string) =>
      p === "workflows" || p.replace(/\\/g, "/").endsWith("/workflows");
    const isDefaultAgentPath = (p: string) =>
      p === ".open-dynamic-workflow/agents" || p.replace(/\\/g, "/").endsWith("/.open-dynamic-workflow/agents");
    const isDefaultToolPath = (p: string) =>
      p === ".open-dynamic-workflow/tools" || p.replace(/\\/g, "/").endsWith("/.open-dynamic-workflow/tools");

    const hasWorkflowDiag = allDiags.some(
      (d) =>
        d.resourceType === "workflow" &&
        d.code === "LIST_DIRECTORY_NOT_FOUND" &&
        isDefaultWorkflowPath(d.path) &&
        d.hint?.code === "PROJECT_INIT_MISSING"
    );
    const hasAgentDiag = allDiags.some(
      (d) =>
        d.resourceType === "agent" &&
        d.code === "LIST_DIRECTORY_NOT_FOUND" &&
        isDefaultAgentPath(d.path) &&
        d.hint?.code === "PROJECT_INIT_MISSING"
    );
    const hasToolDiag = allDiags.some(
      (d) =>
        d.resourceType === "tool" &&
        d.code === "LIST_DIRECTORY_NOT_FOUND" &&
        isDefaultToolPath(d.path) &&
        d.hint?.code === "PROJECT_INIT_MISSING"
    );

    return hasWorkflowDiag && hasAgentDiag && hasToolDiag;
  }

  private renderTargeted(result: ListResult, type: ListResourceType): void {
    const resources = result.resources.filter((r) => r.type === type);
    this.streams.stdout.write(`\n--- ${type.toUpperCase()}S ---\n`);
    if (resources.length === 0) {
      this.streams.stdout.write(`No ${type}s found.\n`);
      return;
    }

    if (this.verbose) {
      this.renderVerboseResources(resources);
    } else {
      this.renderTable(resources);
    }
  }

  private renderAll(result: ListResult): void {
    const types: ListResourceType[] = ["workflow", "agent", "tool"];
    for (const type of types) {
      const resources = result.resources.filter((r) => r.type === type);
      this.streams.stdout.write(`\n--- ${type.toUpperCase()}S ---\n`);
      if (resources.length === 0) {
        this.streams.stdout.write(`No ${type}s found.\n`);
        continue;
      }
      if (this.verbose) {
        this.renderVerboseResources(resources);
      } else {
        this.renderTable(resources);
      }
    }
  }

  private renderTable(resources: ListedResource[]): void {
    const headers = ["ID/NAME", "DESCRIPTION"];
    const rows = resources.map((r) => [
      r.type === "workflow" ? r.name : r.id,
      r.description || "",
    ]);

    const colWidths: [number, number] = [
      headers[0]!.length,
      headers[1]!.length,
    ];

    for (const row of rows) {
      colWidths[0] = Math.max(colWidths[0], row[0]?.length ?? 0);
      colWidths[1] = Math.max(colWidths[1], row[1]?.length ?? 0);
    }

    const formatRow = (row: string[]) => {
      const c0 = (row[0] || "").padEnd(colWidths[0]);
      const c1 = (row[1] || "").padEnd(colWidths[1]);
      return `${c0}  ${c1}\n`;
    };

    this.streams.stdout.write(formatRow(headers));
    this.streams.stdout.write(
      colWidths.map((w) => "-".repeat(w)).join("  ") + "\n"
    );
    for (const row of rows) {
      this.streams.stdout.write(formatRow(row));
    }
  }

  private renderVerboseResources(resources: ListedResource[]): void {
    for (const r of resources) {
      const idOrName = r.type === "workflow" ? r.name : r.id;
      this.streams.stdout.write(`\n[${r.type.toUpperCase()}] ${idOrName}\n`);
      this.streams.stdout.write(`  Description: ${r.description || "N/A"}\n`);
      this.streams.stdout.write(`  Path: ${r.path}\n`);
      if (r.type === "workflow") {
        if (r.version) this.streams.stdout.write(`  Version: ${r.version}\n`);
        if (r.tags && r.tags.length > 0) this.streams.stdout.write(`  Tags: ${r.tags.join(", ")}\n`);
        if (r.phases && r.phases.length > 0) this.streams.stdout.write(`  Phases: ${r.phases.join(", ")}\n`);
      } else if (r.type === "agent") {
        if (r.metadata && Object.keys(r.metadata).length > 0) {
          this.streams.stdout.write(`  Metadata: ${JSON.stringify(r.metadata)}\n`);
        }
        if (r.requiredInputs && r.requiredInputs.length > 0)
          this.streams.stdout.write(`  Required Inputs: ${r.requiredInputs.join(", ")}\n`);
      } else if (r.type === "tool") {
        if (r.requiredInputs && r.requiredInputs.length > 0)
          this.streams.stdout.write(`  Required Inputs: ${r.requiredInputs.join(", ")}\n`);
        if (r.defaultTimeoutMs) this.streams.stdout.write(`  Default Timeout: ${r.defaultTimeoutMs}ms\n`);
        if (r.inputSchema) this.streams.stdout.write(`  Input Schema: ${JSON.stringify(r.inputSchema)}\n`);
        if (r.outputSchema) this.streams.stdout.write(`  Output Schema: ${JSON.stringify(r.outputSchema)}\n`);
      }
    }
  }

  private renderDiagnostics(diagnostics: ListDiagnostic[], title: string): void {
    if (diagnostics.length === 0) return;
    this.streams.stdout.write(`\n${title}:\n`);
    for (const d of diagnostics) {
      this.streams.stdout.write(`  - [${d.resourceType}] ${d.path}: ${d.message} (${d.code})\n`);
      if (d.hint && d.hint.message) {
        this.streams.stdout.write(`    Hint: ${d.hint.message}\n`);
      }
    }
  }
}
