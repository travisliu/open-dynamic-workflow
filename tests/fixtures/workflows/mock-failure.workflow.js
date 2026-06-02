export const meta = {
  name: "mock-failure",
  description: "Mock workflow with one failed agent",
  phases: ["review"]
};

phase("review");

const reviews = await parallel({
  ok: () => agent({
    id: "review-ok",
    provider: "mock",
    prompt: "This one should succeed."
  }),
  fail: () => agent({
    id: "review-fail",
    provider: "mock",
    prompt: "This one should fail.",
    metadata: { mockResponseKey: "failure" }
  })
});

export default { reviews };
