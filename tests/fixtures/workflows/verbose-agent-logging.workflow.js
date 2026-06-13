export const meta = {
  name: "verbose-agent-logging",
  description: "verbose agent logging fixture"
};

export default async function workflow({ agent, args }) {
  const id = args.subcase === "fail" ? "review-fail" : (args.subcase === "timeout" ? "verbose-timeout" : "verbose-review");
  const timeoutMs = args.subcase === "timeout" ? 100 : 30000;

  return await agent({
    id,
    provider: "mock",
    prompt: "Review token SECRET_FROM_ENV",
    timeoutMs,
    schema: id === "verbose-review" ? {
      type: "object",
      properties: {
        summary: { type: "string" }
      },
      required: ["summary"],
      additionalProperties: false
    } : undefined
  });
}
