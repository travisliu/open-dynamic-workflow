import { defineTool } from "@travisliu/open-dynamic-workflow";
export default defineTool({
  id: "invalid-tool",
  description: "An invalid tool",
  run: async () => {},
  inputSchema: { type: "object" },
  defaultTimeoutMs: -1
});
