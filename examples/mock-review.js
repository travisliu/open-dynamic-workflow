export const meta = {
  name: "mock-review",
  description: "Demonstrates execflow with the mock provider",
  phases: ["review", "summarize"]
};

phase("review");

log("Starting mock review");

const reviews = await parallel({
  auth: () => agent({
    id: "review-auth",
    provider: "mock",
    prompt: "Review src/auth.ts for correctness issues.",
    schema: {
      type: "object",
      properties: {
        findings: {
          type: "array",
          items: { type: "string" }
        }
      },
      required: ["findings"]
    }
  }),
  billing: () => agent({
    id: "review-billing",
    provider: "mock",
    prompt: "Review src/billing.ts for API design issues."
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
