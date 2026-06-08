export const meta = {
  name: "review-changes",
  description: "Small fan-out/fan-in review workflow using mock agents.",
  phases: ["review", "verify", "summarize"]
};

phase("review");

const reviews = await parallel({
  correctness: () => agent("Review the change for correctness risks.", { id: "correctness-review", provider: "mock" }),
  security: () => agent("Review the change for security risks.", { id: "security-review", provider: "mock" }),
  tests: () => agent("Review the change for missing tests.", { id: "test-review", provider: "mock" })
});

phase("verify");

const verification = await agent("Adversarially verify these review findings and remove weak claims:\n" + JSON.stringify(reviews, null, 2), {
  id: "adversarial-verifier",
  provider: "mock"
});

phase("summarize");

const summary = await agent("Summarize the verified review into a merge recommendation:\n" + verification, {
  id: "review-summary",
  provider: "mock"
});

export default { reviews, verification, summary };
