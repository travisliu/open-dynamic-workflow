export const meta = {
  name: "dangerously-full-access-valid",
  description: "A valid dangerously-full-access permissions workflow"
};

const result = await agent({
  prompt: "task 1",
  permissions: { mode: "dangerously-full-access" }
});

export default { result };
