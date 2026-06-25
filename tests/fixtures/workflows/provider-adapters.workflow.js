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
} else if (args.subcase === "03.11") {
  result = await agent({
    id: "copilot-test",
    provider: "copilot",
    prompt: "Return a short Copilot adapter response."
  });
} else if (args.subcase === "03.12") {
  result = await agent({
    id: "copilot-full-access",
    provider: "copilot",
    prompt: "Test Copilot full access",
    permissions: {
      mode: "dangerously-full-access"
    }
  });
} else if (args.subcase === "03.13") {
  result = await agent({
    id: "copilot-json",
    provider: "copilot",
    prompt: "Return JSON",
    schema: { type: "object", properties: { ok: { const: true }, files: { type: "array" } }, required: ["ok", "files"] }
  });
} else if (args.subcase === "03.14") {
  result = await agent({
    id: "copilot-invalid-json",
    provider: "copilot",
    prompt: "Return invalid JSON",
    schema: { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"] }
  });
} else if (args.subcase === "03.15") {
  result = await agent({
    id: "copilot-schema-invalid",
    provider: "copilot",
    prompt: "Return schema-invalid JSON",
    schema: { type: "object", properties: { ok: { const: true } }, required: ["ok"] }
  });
} else if (args.subcase === "03.16") {
  result = await agent({
    id: "codex-thinking",
    provider: "codex",
    prompt: "Test codex thinking",
    thinkingEffort: "high"
  });
} else if (args.subcase === "03.17") {
  result = await agent({
    id: "pi-thinking",
    provider: "pi",
    prompt: "Test pi thinking",
    thinkingEffort: "medium"
  });
} else if (args.subcase === "03.18") {
  result = await agent({
    id: "opencode-thinking",
    provider: "opencode",
    prompt: "Test opencode thinking",
    thinkingEffort: "low"
  });
} else if (args.subcase === "03.19") {
  result = await agent({
    id: "opencode-thinking-off",
    provider: "opencode",
    prompt: "Test opencode thinking off",
    thinkingEffort: "off"
  });
} else if (args.subcase === "03.20") {
  result = await agent({
    id: "gemini-thinking-unsupported",
    provider: "gemini",
    prompt: "Test gemini thinking unsupported",
    thinkingEffort: "high"
  });
} else if (args.subcase === "03.21") {
  result = await agent({
    id: "codex-thinking-unsupported",
    provider: "codex",
    prompt: "Test codex thinking unsupported",
    thinkingEffort: "off"
  });
} else if (args.subcase === "03.22") {
  result = await agent({
    id: "opencode-thinking-conflict",
    provider: "opencode",
    prompt: "Test opencode thinking conflict",
    thinkingEffort: "high",
    metadata: {
      opencodeVariant: "low"
    }
  });
}

export default { result };
