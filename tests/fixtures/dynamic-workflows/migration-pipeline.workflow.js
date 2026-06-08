export const meta = {
  name: "migration-pipeline",
  description: "Small item pipeline for migration planning and review.",
  phases: ["migrate"]
};

phase("migrate");

const files = ["src/a.ts", "src/b.ts"];

const results = await pipeline(files, [
  {
    name: "plan",
    run: async (file, ctx) => {
      return ctx.agent({
        id: ctx.agentId("plan"),
        provider: "mock",
        prompt: `Plan a minimal migration for ${file}.`
      });
    }
  },
  {
    name: "review",
    run: async (plan, ctx) => {
      return ctx.agent({
        id: ctx.agentId("review"),
        provider: "mock",
        prompt: `Review this migration plan for risk:\n${JSON.stringify(plan, null, 2)}`
      });
    }
  }
], {
  label: "migration",
  strategy: "item-streaming",
  concurrency: 2
});

export default results;
