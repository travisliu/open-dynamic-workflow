export const meta = {
  name: "parallel-review",
  description: "Run independent review agents in parallel and summarize the results",
  phases: ["review", "summarize"]
};

phase("review");

context.set("reviewType", "code-and-security");

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

  tests: () => agent({
    id: "test-review",
    provider: "gemini",
    prompt: "Review test coverage and missing test cases."
  })
});

phase("summarize");

const summary = await agent({
  id: "summary",
  provider: "gemini",
  prompt: `Summarize these reviews:\n${JSON.stringify(reviews, null, 2)}`
});

export default {
  reviews,
  summary,
  context: context.snapshot()
};
