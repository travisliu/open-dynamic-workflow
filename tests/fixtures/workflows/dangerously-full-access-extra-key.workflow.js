export const meta = {
  name: "dangerously-full-access-extra-key",
  description: "An invalid permissions extra key workflow"
};

const result = await agent({
  prompt: "task 1",
  permissions: { mode: "dangerously-full-access", approval: "never" }
});

export default { result };
