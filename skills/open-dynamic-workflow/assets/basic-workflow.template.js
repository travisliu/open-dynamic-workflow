export const meta = {
  name: "basic-workflow",
  description: "Run a basic Open Dynamic Workflow workflow",
  phases: ["execute"]
};

phase("execute");

context.set("status", "running");

const result = await agent({
  id: "main-task",
  provider: "codex",
  prompt: "Complete the requested task and return exactly one JSON object.",
  schema: {
    type: "object",
    properties: {
      summary: { type: "string" },
      nextSteps: {
        type: "array",
        items: { type: "string" }
      }
    },
    required: ["summary", "nextSteps"]
  },
  structuredOutput: {
    transport: "auto"
  }
});

export default {
  result,
  finalStatus: context.get("status")
};
