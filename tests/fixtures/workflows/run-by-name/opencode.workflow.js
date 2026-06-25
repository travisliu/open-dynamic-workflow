export const meta = {
  name: "opencode-test",
  description: "OpenCode thinking effort integration test workflow"
};

await agent({
  id: "opencode-agent",
  provider: "opencode",
  prompt: "Write a function"
});
