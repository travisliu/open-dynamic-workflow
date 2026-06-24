export const meta = {
  name: "demo-quality-gate",
  description: "Loops quality-gate verification and fixing until npm-quality-gate finds no remaining issues.",
  phases: ["verify"]
};

phase("verify");

const loopResult = await loop({
  label: "quality-gate-loop",
  initialState: {
    roundsCompleted: 0
  },
  options: {
    maxRounds: 5,
    timeoutMs: 1_800_000
  },
  run: async (state, ctx) => {
    ctx.log("Executing quality gate tool");

    const gateResult = await ctx.tool({
      id: ctx.toolId("npm-quality-gate"),
      definition: "npm-quality-gate",
      args: {
        cwd: ".",
        continueOnFailure: true
      }
    });

    ctx.log("Quality gate results", {
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

    ctx.log("Structured issues to fix", issueSummary);

    let fixResult = null;

    if (issueSummary.totalIssueCount > 0) {
      fixResult = await ctx.agent({
        id: ctx.agentId("quality-gate-fixer"),
        definition: "quality-gate-fixer",
        gateSummary: JSON.stringify({
          ok: gateResult.ok,
          status: gateResult.status,
          failedCommand: gateResult.failedCommand,
          summary: gateResult.summary
        }, null, 2),
        structuredIssues: JSON.stringify({
          test: testFixes,
          lint: lintFixes,
          build: buildFixes
        }, null, 2)
      });
    } else {
      ctx.log("No structured issues found. Skipping fix agent.", {
        totalIssueCount: issueSummary.totalIssueCount
      });
    }

    const nextState = {
      roundsCompleted: state.roundsCompleted + 1
    };

    ctx.log("Quality gate loop round complete", {
      roundNumber: nextState.roundsCompleted,
      totalIssueCount: issueSummary.totalIssueCount,
      gateStatus: gateResult.status,
      fixStatus: fixResult?.status ?? null
    });

    return {
      done: issueSummary.totalIssueCount === 0,
      nextState
    };
  }
});

export default {
  loopResult
};
