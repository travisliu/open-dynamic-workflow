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
    const roundResult = await ctx.workflow({
      name: "demo-quality-gate-round"
    });

    const nextState = {
      roundsCompleted: state.roundsCompleted + 1
    };

    ctx.log("Quality gate loop round complete", {
      roundNumber: nextState.roundsCompleted,
      totalIssueCount: roundResult.issueSummary.totalIssueCount,
      gateStatus: roundResult.gateResult.status,
      fixStatus: roundResult.fixResult?.status ?? null
    });

    return {
      done: roundResult.issueSummary.totalIssueCount === 0,
      nextState
    };
  }
});

export default {
  loopResult
};
