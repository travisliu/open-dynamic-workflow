export interface DryRunSummary {
  workflowFile: string;
  workflowName: string;
  description: string;
  phases: string[];
  provider: string;
  requestedProvider?: string | undefined;
  resolvedProvider?: string | undefined;
  providerAlias?: string | undefined;
  providerAliasChain?: readonly string[] | undefined;
  defaultModel?: string | null | undefined;
  providers?: Record<string, { defaultModel?: string | null | undefined; modelArg?: any }> | undefined;
  concurrency: number;
  timeoutMs: number;
  reportMode: string;
  outDir: string;
  verbose?: boolean | undefined;
}

export function printValidationSuccess(workflowName: string, workflowFile?: string): void {
  if (workflowFile) {
    console.log(`✓ Validated workflow "${workflowName}" at ${workflowFile}`);
  } else {
    console.log(`✓ Workflow is valid: ${workflowName}`);
  }
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
  if (summary.providerAlias) {
    console.log(`Default provider: ${summary.requestedProvider} (alias -> ${summary.resolvedProvider})`);
    if (summary.providerAliasChain && summary.providerAliasChain.length > 0) {
      console.log(`Alias chain: ${summary.providerAliasChain.join(" -> ")}`);
    }
  } else {
    console.log(`Default provider: ${summary.provider}`);
  }
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
  if (summary.verbose) {
    console.log(`Verbose logging: enabled`);
  }
  console.log(`Artifacts root: ${summary.outDir}\n`);

  if (summary.verbose) {
    console.log(`Agent Command Previews:`);
    console.log(`  (Command previews are unavailable in dry-run mode)\n`);
  }

  console.log(`No providers were invoked.`);
}
