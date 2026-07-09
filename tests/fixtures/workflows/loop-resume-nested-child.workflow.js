export const meta = {
  name: "loop-resume-nested-child",
  description: "Child workflow for loop resume cache test"
};

export default async () => {
  const res = await agent({
    id: "nested-child-agent",
    provider: "mock",
    prompt: "child agent prompt"
  });
  return res;
};
