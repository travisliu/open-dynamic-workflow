// This file is an example of defining a tool in Open Dynamic Workflow.
// Note: defineTool is provided in the global scope by the runtime during tool module loading.
// There is no need to import defineTool or any package dependencies.

export default defineTool({
  id: "tool-workflow-example",
  description: "A sample tool that performs a simple length check and returns the result",
  inputSchema: {
    type: "object",
    properties: {
      data: { type: "string" }
    },
    required: ["data"]
  },
  outputSchema: {
    type: "object",
    properties: {
      success: { type: "boolean" },
      length: { type: "number" }
    },
    required: ["success", "length"]
  },
  run(input, context) {
    context.log("Running sample tool-workflow-example tool", { data: input.data });
    return {
      success: true,
      length: input.data.length
    };
  }
});
