export interface DryRunSummary {
  workflowFile: string;
  workflowName: string;
  description: string;
  phases: string[];
  provider: string;
  defaultModel?: string | null | undefined;
  providers?: Record<string, { defaultModel?: string | null | undefined; modelArg?: any }> | undefined;
  concurrency: number;
  timeoutMs: number;
  reportMode: string;
  outDir: string;
}

export function printValidationSuccess(workflowName: string): void {
  console.log(`✓ Workflow is valid: ${workflowName}`);
}

export function printValidationIssues(issues: readonly { message: string }[]): void {
  console.log(`✕ Workflow validation failed:\n`);
  issues.forEach((issue, idx) => {
    console.log(`${idx + 1}. ${issue.message}`);
  });
}

export function printDryRunSummary(summary: DryRunSummary): void {
  console.log(`Dry run: ${summary.workflowName}\n`);
  console.log(`Workflow file: ${summary.workflowFile}`);
  console.log(`Description: ${summary.description}`);
  console.log(`Phases: ${summary.phases.join(", ")}`);
  console.log(`Default provider: ${summary.provider}`);
  if (summary.defaultModel !== undefined) {
    console.log(`Global default model: ${summary.defaultModel}`);
  }
  if (summary.providers) {
    console.log(`Providers:`);
    for (const [name, p] of Object.entries(summary.providers)) {
      const modelArgStr = p.modelArg === false
        ? "[no model selection]"
        : (p.modelArg && typeof p.modelArg === "object" && p.modelArg.flag
          ? `[model flag: ${p.modelArg.flag}]`
          : "[default model flag]");
      console.log(`  - ${name}: default model = ${p.defaultModel ?? "none"}, ${modelArgStr}`);
    }
  }
  console.log(`Concurrency: ${summary.concurrency}`);
  console.log(`Timeout: ${summary.timeoutMs} ms`);
  console.log(`Report mode: ${summary.reportMode}`);
  console.log(`Artifacts root: ${summary.outDir}\n`);
  console.log(`No providers were invoked.`);
}
