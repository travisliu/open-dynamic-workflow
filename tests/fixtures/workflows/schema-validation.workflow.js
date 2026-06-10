export const meta = {
  name: "Structured Output Workflow",
  description: "A workflow that tests valid structured output",
  version: "0.1.0"
};

let result;
if (args.subcase === "09.01") {
  result = await agent({
    id: "structured-agent",
    provider: "mock",
    prompt: "Return findings as JSON",
    label: "structured-agent",
    schema: {
      type: "object",
      properties: {
        findings: {
          type: "array",
          items: { type: "string" }
        }
      },
      required: ["findings"]
    },
    structuredOutput: {
      transport: "prompt"
    }
  });
} else if (args.subcase === "09.02") {
  result = await agent({
    id: "schema-fail-agent",
    provider: "mock",
    prompt: "Return invalid JSON for this schema.",
    schema: {
      type: "object",
      properties: {
        findings: {
          type: "array",
          items: { type: "string" }
        }
      },
      required: ["findings"]
    },
    structuredOutput: {
      transport: "prompt"
    }
  });
} else if (args.subcase === "09.03") {
  result = await agent({
    id: "malformed-json-agent",
    provider: "mock",
    prompt: "Return malformed JSON.",
    schema: {
      type: "object",
      properties: {
        findings: {
          type: "array",
          items: { type: "string" }
        }
      },
      required: ["findings"]
    },
    structuredOutput: {
      transport: "prompt"
    }
  });
} else if (args.subcase === "09.04") {
  result = await agent({
    id: "plaintext-agent",
    provider: "mock",
    prompt: "Return some plain text",
    label: "plaintext-agent"
  });
} else if (args.subcase === "09.05") {
  result = await agent({
    id: "mock-native-structured-output",
    provider: "mock",
    prompt: "Return findings as JSON",
    schema: {
      type: "object",
      properties: {
        findings: {
          type: "array",
          items: { type: "string" }
        }
      },
      required: ["findings"]
    },
    structuredOutput: { transport: "native" }
  });
}

export default { result };
