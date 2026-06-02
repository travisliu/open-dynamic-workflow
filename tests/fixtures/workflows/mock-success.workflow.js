export const meta = {
  name: "mock-success",
  description: "Simple successful mock workflow",
  phases: ["review", "summarize"]
};

phase("review");

const review = await agent({
  id: "review-auth",
  provider: "mock",
  prompt: "Review src/auth.ts"
});

phase("summarize");

const summary = await agent({
  id: "summary",
  provider: "mock",
  prompt: `Summarize: ${JSON.stringify(review)}`
});

export default {
  review,
  summary
};
