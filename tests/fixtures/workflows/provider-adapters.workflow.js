export const meta = {
  name: "Workflow",
  description: "Provider adapter execution"
};

let result;
if (args.subcase === "03.01") {
  result = await agent({
    id: "review-1",
    provider: "mock",
    prompt: "Review src/auth.ts"
  });
} else if (args.subcase === "03.02") {
  result = await agent({
    id: "gemini-full-access",
    provider: "gemini",
    prompt: "Test gemini full access",
    permissions: {
      mode: "dangerously-full-access"
    }
  });
} else if (args.subcase === "03.04") {
  result = await agent({
    id: "unknown-agent",
    provider: "unknown-provider",
    prompt: "Test unknown provider"
  });
}

export default { result };
