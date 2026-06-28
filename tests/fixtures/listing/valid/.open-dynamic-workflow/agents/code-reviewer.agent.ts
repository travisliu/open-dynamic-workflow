// @ts-ignore
import { defineAgent } from "@prmflow/openflow";

export default defineAgent({
  id: "code-reviewer",
  description: "Reviews code for quality and security.",
  metadata: {
    category: "quality",
    model: "gemini-2.0-flash"
  },
  inputSchema: {
    type: "object",
    properties: {
      code: { type: "string" },
      context: { type: "string" }
    },
    required: ["code"]
  },
  run: async () => {
    throw new Error("list must not execute agent run");
  }
});
