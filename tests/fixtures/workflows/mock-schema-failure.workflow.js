export const meta = {
  name: "mock-schema-failure",
  description: "Mock workflow with schema validation failure",
  phases: ["validate"]
};

phase("validate");

const result = await agent({
  id: "schema-fail",
  provider: "mock",
  prompt: "Return invalid JSON for this schema.",
  metadata: { mockResponseKey: "invalid-schema" },
  schema: {
    type: "object",
    properties: {
      findings: {
        type: "array",
        items: { type: "string" }
      }
    },
    required: ["findings"]
  }
});

export default { result };
