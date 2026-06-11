export const meta = {
  name: "child-agent",
  description: "Child calling an agent"
};

const result = await agent({
  id: "child-agent",
  provider: "mock",
  prompt: args.prompt
});

return result;
