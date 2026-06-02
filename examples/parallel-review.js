export const meta = {
  name: "parallel-review",
  description: "Review changed files with multiple coding-agent CLIs",
  phases: ["review", "summarize"]
};

phase("review");

const reviews = await parallel({
  codex: () => agent({
    id: "codex-review",
    provider: "codex",
    prompt: "Review the changed files for correctness issues."
  }),
  gemini: () => agent({
    id: "gemini-review",
    provider: "gemini",
    prompt: "Review the changed files for API design issues."
  })
});

phase("summarize");

const summary = await agent({
  id: "summary",
  provider: "mock",
  prompt: `Summarize these reviews:\n${JSON.stringify(reviews, null, 2)}`
});

export default {
  reviews,
  summary
};
