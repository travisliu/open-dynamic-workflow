export default defineAgent({
  id: "developer-subagent",
  description: "Regression shared agent",
  inputSchema: {
    type: "object",
    properties: {
      prompt: { type: "string" }
    },
    required: ["prompt"]
  },
  run: async (context, runtime) => {
    return await runtime.agent({
      provider: "mock",
      prompt: context.prompt
    });
  }
});
