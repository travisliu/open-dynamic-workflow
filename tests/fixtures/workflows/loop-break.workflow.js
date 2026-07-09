export const meta = {
  name: "loop-break",
  description: "Test loop completion (formerly break)"
};

const loopResult = await loop({
  label: "loop-break",
  initialState: { count: 0 },
  options: { maxRounds: 5 },
  run: async (state, ctx) => {
    const nextCount = state.count + 1;

    // Use global context directly:
    const prev = context.get(`round_${state.count}`) || "start";
    context.set(`round_${nextCount}`, `val_${nextCount}_${prev}`);

    await ctx.agent({
      id: ctx.agentId(`agent-${nextCount}`),
      provider: "mock",
      prompt: `Round ${nextCount}`
    });

    if (nextCount >= 2) {
      return {
        done: true,
        nextState: { count: nextCount }
      };
    }

    return {
      done: false,
      nextState: { count: nextCount }
    };
  }
});

export default {
  loopResult,
  finalContextSnapshot: context.snapshot()
};
