export const meta = {
  name: "pipeline-review",
  description: "Analyze multiple items through ordered review stages",
  phases: ["review", "summarize"]
};

const items = ["src/auth.js", "src/billing.js", "src/api.js"];

context.set("pipeline-started", true);

phase("review");

const itemResults = await pipeline(
  items,
  [
    {
      name: "analyze",
      run: (item, ctx) => {
        context.set(`item-status:${item}`, "analyzing");
        return ctx.agent({
          id: ctx.agentId("analyze"),
          provider: "codex",
          prompt: `Analyze ${item} for correctness, security, and maintainability risks. Return exactly one JSON object.`,
          schema: {
            type: "object",
            properties: {
              item: { type: "string" },
              findings: {
                type: "array",
                items: { type: "string" }
              }
            },
            required: ["item", "findings"]
          },
          structuredOutput: {
            transport: "auto"
          }
        });
      }
    },
    {
      name: "plan",
      run: (analysis, ctx) => ctx.agent({
        id: ctx.agentId("plan"),
        provider: "gemini",
        prompt: `Create a remediation plan from this analysis:\n${JSON.stringify(analysis, null, 2)}`
      })
    },
    {
      name: "review-plan",
      run: (plan, ctx) => ctx.agent({
        id: ctx.agentId("review-plan"),
        provider: "codex",
        prompt: `Review this plan for safety and completeness:\n${JSON.stringify(plan, null, 2)}`
      })
    }
  ],
  {
    label: "item-review-pipeline",
    strategy: "item-streaming",
    concurrency: 3,
    failFast: false
  }
);

phase("summarize");

const summary = await agent({
  id: "summary",
  provider: "gemini",
  prompt: `Summarize these pipeline results:\n${JSON.stringify(itemResults, null, 2)}`
});

export default {
  itemResults,
  summary,
  context: context.snapshot()
};
