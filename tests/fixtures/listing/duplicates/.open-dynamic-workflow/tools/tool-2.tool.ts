import { defineTool } from "@travisliu/open-dynamic-workflow";
export default defineTool({
  id: "duplicate-tool",
  description: "Second duplicate tool",
  run: async () => {},
  inputSchema: { type: "object" },
  execute: async () => {}
});
