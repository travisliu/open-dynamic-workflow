export const meta = {
  name: "example-workflow",
  description: "A starter Open Dynamic Workflow workflow created by open-dynamic-workflow init.",
  phases: ["run"]
};

phase("run");

const result = await agent({
  id: "starter-task",
  prompt: "Explain what this starter Open Dynamic Workflow workflow does."
});

export default {
  result
};
