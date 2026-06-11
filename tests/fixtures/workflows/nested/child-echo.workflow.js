export const meta = {
  name: "child-echo",
  description: "Child echo with schema",
  inputSchema: {
    type: "object",
    properties: {
      target: { type: "string" }
    },
    required: ["target"],
    additionalProperties: false
  }
};

return { target: args.target };
