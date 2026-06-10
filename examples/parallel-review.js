export const meta = {
  name: "parallel-review",
  description: "Review changed files with parallel Codex agents",
  phases: ["review", "summarize"]
};

phase("review");

const reviews = await parallel({
  correctness: () => agent("Review the changed files for correctness issues.", {
    id: "correctness-review"
  }),
  security: () => agent("Review the changed files for security issues.", {
    id: "security-review"
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
