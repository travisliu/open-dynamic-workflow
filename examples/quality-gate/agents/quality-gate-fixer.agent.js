const fixResultSchema = {
  type: "object",
  properties: {
    status: {
      type: "string",
      enum: ["fixed", "partially-fixed", "blocked"]
    },
    summary: { type: "string" },
    changedFiles: {
      type: "array",
      items: { type: "string" }
    },
    remainingIssues: {
      type: "array",
      items: { type: "string" }
    }
  },
  required: ["status", "summary", "changedFiles", "remainingIssues"],
  additionalProperties: false
};

export default defineAgent({
  id: "quality-gate-fixer",
  description: "Fix structured quality-gate issues found by the npm-quality-gate tool.",
  inputSchema: {
    type: "object",
    required: ["gateSummary", "structuredIssues"],
    properties: {
      gateSummary: { type: "string" },
      structuredIssues: { type: "string" }
    }
  },
  agentPrompt: `You are fixing structured quality-gate issues in the current repository.

Use the issue lists below as the source of truth. Apply code changes directly in the workspace.

Requirements:
- Fix the reported issues in code.
- Use the structured JSON issue payloads below instead of inferring extra diagnostics from stdout or stderr.
- Rerun only the relevant commands as needed to verify your changes.
- If some issues cannot be fixed safely, explain the blocker briefly.
- Return exactly one JSON object matching the provided schema.

Quality gate summary:
{{gateSummary}}

Structured issues:
{{structuredIssues}}`,
  run: async (context, runtime) => {
    return await runtime.agent({
      provider: "codex",
      model: "gpt-5.4-mini",
      // dangerously-full-access: this agent must edit files and rerun local checks autonomously.
      permissions: { mode: "dangerously-full-access" },
      structuredOutput: {
        transport: "auto"
      },
      schema: fixResultSchema,
      prompt: runtime.renderAgentPrompt(context)
    });
  }
});
