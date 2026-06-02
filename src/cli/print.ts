export interface DryRunSummary {
  workflowFile: string;
  workflowName: string;
  description: string;
  phases: string[];
  provider: string;
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
  console.log(`Concurrency: ${summary.concurrency}`);
  console.log(`Timeout: ${summary.timeoutMs} ms`);
  console.log(`Report mode: ${summary.reportMode}`);
  console.log(`Artifacts root: ${summary.outDir}\n`);
  console.log(`No providers were invoked.`);
}
