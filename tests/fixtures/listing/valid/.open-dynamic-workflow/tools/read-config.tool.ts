// @ts-ignore
import { defineTool } from "@prmflow/openflow";

export default defineTool({
  id: "read-config",
  description: "Reads configuration from a file.",
  inputSchema: {
    type: "object",
    properties: {
      fileName: { type: "string" }
    },
    required: ["fileName"]
  },
  outputSchema: {
    type: "object",
    properties: {
      content: { type: "string" }
    }
  },
  defaultTimeoutMs: 5000,
  run: async () => {
    throw new Error("list must not execute tool run");
  }
});
