import { defineTool } from "@travisliu/open-dynamic-workflow";
export default defineTool({
  id: "valid-tool",
  description: "A valid tool",
  run: async () => {},
  inputSchema: { type: "object" },
  execute: async () => {}
});
