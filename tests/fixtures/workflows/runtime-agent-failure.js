export const meta = {
  name: "runtime-agent-failure",
  description: "Agent failure is represented as a structured result value"
};

const result = await agent({
  id: "expected-failure",
  provider: "mock",
  prompt: "Return a configured failure"
});

export default { result, ok: result.ok };
