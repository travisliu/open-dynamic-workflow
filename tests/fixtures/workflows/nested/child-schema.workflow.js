export const meta = {
  name: "child-schema",
  description: "Child with input schema",
  inputSchema: {
    type: "object",
    properties: {
      count: { type: "number" }
    },
    required: ["count"]
  }
};

export default async ({ args }) => {
  return args.count;
};
