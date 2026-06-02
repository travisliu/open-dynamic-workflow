export const meta = {
  name: "runtime-parallel-object",
  description: "Parallel object test",
  phases: ["review"]
};

phase("review");

const results = await parallel({
  a: () => agent({ id: "a", provider: "mock", prompt: "Review part A" }),
  b: () => agent({ id: "b", provider: "mock", prompt: "Review part B" })
});

export default { results };
