export const meta = {
  name: "runtime-parallel-array",
  description: "Parallel array test",
  phases: ["review"]
};

phase("review");

const results = await parallel([
  () => agent({ id: "a", provider: "mock", prompt: "Review part A" }),
  () => agent({ id: "b", provider: "mock", prompt: "Review part B" })
]);

export default { results };
