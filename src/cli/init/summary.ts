import { InitResult, InitPlan, ProviderSelection, InitSmokeTestResult } from "./types.js";

export function providerSelectionReason(selection: ProviderSelection): string {
  let text = `Selected default provider: ${selection.defaultProvider}\nReason: ${selection.selectedReason}`;
  if (selection.warning) {
    text += `\nWarning: ${selection.warning}`;
  }
  return text;
}

export function formatInitSummary(result: InitResult): string {
  const { plan, writeResult, smokeTest } = result;
  const lines: string[] = [];

  lines.push("OpenFlow project initialized.");
  lines.push("");
  lines.push(providerSelectionReason(plan.providerSelection));
  lines.push("");

  if (writeResult.created.length > 0) {
    lines.push("Created:");
    writeResult.created.forEach(p => lines.push(`  ${p}`));
  }

  if (writeResult.overwritten.length > 0) {
    lines.push("Overwritten:");
    writeResult.overwritten.forEach(p => lines.push(`  ${p}`));
  }

  if (writeResult.skipped.length > 0) {
    lines.push("Skipped existing files:");
    writeResult.skipped.forEach(p => lines.push(`  ${p}`));
  }

  if (writeResult.reusedDirectories.length > 0) {
    lines.push("Reused existing directories:");
    writeResult.reusedDirectories.forEach(p => lines.push(`  ${p}`));
  }

  lines.push("");
  lines.push("Package scripts were not modified.");
  lines.push("");
  lines.push("Next steps:");
  plan.nextSteps.forEach(step => lines.push(`  ${step}`));

  if (smokeTest.requested && smokeTest.reportMode !== "json") {
    lines.push("");
    lines.push("Smoke test result:");
    lines.push(`  Validation: ${smokeTest.validateStatus}`);
    lines.push(`  Mock run: ${smokeTest.runStatus}`);
  }

  return lines.join("\n");
}

export function formatStrictConflicts(plan: InitPlan): string {
  const lines: string[] = [];
  lines.push("Cannot initialize because --strict was provided and target paths already exist:");
  plan.strictConflicts.forEach(t => lines.push(`  ${t.displayPath}`));
  lines.push("");
  lines.push("No files were written.");
  return lines.join("\n");
}

export function formatCancellationMessage(): string {
  return "Initialization cancelled. No files were written.";
}

export interface PrintInitSummaryInput {
  result: InitResult;
  stdout: NodeJS.WritableStream;
  stderr: NodeJS.WritableStream;
}

export function printInitSummary({ result, stdout, stderr }: PrintInitSummaryInput): void {
  const isJsonSmokeTest = result.smokeTest.requested && result.smokeTest.reportMode === "json";

  if (isJsonSmokeTest) {
    // In JSON smoke test mode, move init summary to stderr to keep stdout clean for the JSON report
    stderr.write(formatInitSummary(result) + "\n");
  } else {
    stdout.write(formatInitSummary(result) + "\n");
  }
}
