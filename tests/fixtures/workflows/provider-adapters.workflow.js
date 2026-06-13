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
} else if (args.subcase === "03.05") {
  result = await agent({
    id: "opencode-test",
    provider: "opencode",
    prompt: "Test opencode adapter"
  });
} else if (args.subcase === "03.06") {
  result = await agent({
    id: "antigravity-test",
    provider: "antigravity",
    prompt: "Test antigravity adapter"
  });
} else if (args.subcase === "03.07") {
  result = await agent({
    id: "pi-test",
    provider: "pi",
    prompt: "Test pi adapter"
  });
} else if (args.subcase === "03.08") {
  result = await agent({
    id: "opencode-full-access",
    provider: "opencode",
    prompt: "Test opencode full access",
    permissions: {
      mode: "dangerously-full-access"
    }
  });
} else if (args.subcase === "03.09") {
  result = await agent({
    id: "antigravity-full-access",
    provider: "antigravity",
    prompt: "Test antigravity full access",
    permissions: {
      mode: "dangerously-full-access"
    }
  });
} else if (args.subcase === "03.10") {
  result = await agent({
    id: "pi-full-access",
    provider: "pi",
    prompt: "Test pi full access",
    permissions: {
      mode: "dangerously-full-access"
    }
  });
}

export default { result };
