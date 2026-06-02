export const meta = {
  name: "simple-mock-workflow",
  description: "Simple mock workflow used for CLI package execution tests",
  phases: ["test"]
};

phase("test");

const result = await agent({
  id: "mock-agent",
  provider: "mock",
  prompt: "Return a successful mock response."
});

export default {
  result
};
