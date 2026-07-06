export const meta = {
  name: "loop-parallel-shared-agent-id",
  description: "Regression test for shared agent ID propagation inside loop + parallel"
};

const result = await loop({
  label: "feature-builder-implementation-phases",
  initialState: { round: 0 },
  options: { maxRounds: 1 },
  run: async (state, ctx) => {
    const tasks = ["a", "b"];

    const results = await parallel(
      tasks.map((task, taskIndex) => () =>
        ctx.agent({
          id: `implement:${state.round + 1}:${taskIndex + 1}`,
          definition: "developer-subagent",
          prompt: `Implement ${task}`
        })
      )
    );

    return {
      done: true,
      nextState: {
        round: state.round + 1,
        results
      }
    };
  }
});

export default result;
