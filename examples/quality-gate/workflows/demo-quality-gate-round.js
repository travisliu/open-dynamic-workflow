export const meta = {
  name: "demo-quality-gate-round",
  description: "Runs one quality-gate pass and optionally asks the fixer agent to address remaining issues.",
  phases: ["gate", "fix"]
};

phase("gate");

log("Executing quality gate tool");

const gateResult = await tool({
  definition: "npm-quality-gate",
  args: {
    cwd: ".",
    continueOnFailure: true
  }
});

log("Quality gate results", {
  ok: gateResult.ok,
  status: gateResult.status,
  summary: gateResult.summary,
  failedCommand: gateResult.failedCommand,
  executedCount: [gateResult.test, gateResult.lint, gateResult.build].filter(Boolean).length
});

const testFixes = gateResult.test?.issueCandidates ?? [];

const lintFixes = (gateResult.lint?.issueCandidates ?? [])
  .filter(issue => issue.severity === "error");

const buildFixes = gateResult.build?.issueCandidates ?? [];

const issueSummary = {
  testIssueCount: testFixes.length,
  lintIssueCount: lintFixes.length,
  buildIssueCount: buildFixes.length,
  totalIssueCount: testFixes.length + lintFixes.length + buildFixes.length
};

const gateSummary = JSON.stringify({
  ok: gateResult.ok,
  status: gateResult.status,
  failedCommand: gateResult.failedCommand,
  summary: gateResult.summary
}, null, 2);

const structuredIssues = JSON.stringify({
  test: testFixes,
  lint: lintFixes,
  build: buildFixes
}, null, 2);

log("Structured issues to fix", issueSummary);

let fixResult = null;

if (issueSummary.totalIssueCount > 0) {
  phase("fix");

  fixResult = await agent({
    id: "quality-gate-fixer",
    definition: "quality-gate-fixer",
    gateSummary,
    structuredIssues
  });
} else {
  log("No structured issues found. Skipping fix agent.", {
    totalIssueCount: issueSummary.totalIssueCount
  });
}

export default {
  gateResult,
  issueSummary,
  fixResult
};
