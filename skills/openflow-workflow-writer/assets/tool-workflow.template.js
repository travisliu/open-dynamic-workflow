export const meta = {
  name: "tool-workflow",
  description: "Run a workflow that invokes a registered tool and processes the result with an agent",
  phases: ["fetch", "analyze"]
};

phase("fetch");

// Invoke a registered deterministic tool to read data
const data = await tool({
  definition: "read-json",
  args: {
    path: "input.json"
  }
});

phase("analyze");

// Pass the tool output directly to a provider-backed agent
const analysis = await agent({
  id: "analyze-data",
  provider: "codex",
  prompt: `Analyze this dataset for anomalies and correctness:\n${JSON.stringify(data, null, 2)}`
});

export default {
  data,
  analysis
};
