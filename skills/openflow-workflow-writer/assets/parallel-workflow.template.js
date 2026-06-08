export const meta = {
  name: "parallel-review",
  description: "Run independent review agents in parallel and summarize the results",
  phases: ["review", "summarize"]
};

phase("review");

const reviews = await parallel({
  correctness: () => agent({
    id: "correctness-review",
    provider: "codex",
    prompt: "Review for correctness issues."
  }),

  security: () => agent({
    id: "security-review",
    provider: "codex",
    prompt: "Review for security risks."
  }),

  tests: () => agent("Review test coverage and missing test cases.", {
    id: "test-review"
  })
});

phase("summarize");

const summary = await agent(`Summarize these reviews:\n${JSON.stringify(reviews, null, 2)}`, {
  id: "summary",
});

export default {
  reviews,
  summary
};
