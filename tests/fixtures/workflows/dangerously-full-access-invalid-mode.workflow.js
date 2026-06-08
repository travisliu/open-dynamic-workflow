export const meta = {
  name: "dangerously-full-access-invalid-mode",
  description: "An invalid permissions mode workflow"
};

const result = await agent({
  prompt: "task 1",
  permissions: { mode: "yolo" }
});

export default { result };
