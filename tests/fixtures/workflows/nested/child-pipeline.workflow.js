export const meta = {
  name: "child-pipeline",
  description: "Child using pipeline"
};

const result = await pipeline(
  ["item1", "item2"],
  [
    {
      name: "process",
      run: async (ctx, item) => {
        return await ctx.agent({
          id: "pipeline-agent",
          provider: "mock",
          prompt: `Process ${item}`
        });
      }
    }
  ]
);

return result;
