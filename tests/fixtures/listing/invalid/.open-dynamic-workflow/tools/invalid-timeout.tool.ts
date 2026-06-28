// @ts-ignore
import { defineTool } from "@prmflow/openflow";

export default defineTool({
  id: "invalid-timeout",
  description: "Tool with invalid timeout",
  run: async () => {},
  inputSchema: { type: "object" },
  defaultTimeoutMs: -100 // invalid
});
