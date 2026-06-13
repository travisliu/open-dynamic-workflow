import { defineTool } from "@prmflow/openflow";
export default defineTool({
  id: "custom-tool",
  description: "A tool in a custom directory",
  run: async () => {},
  inputSchema: { type: "object" },
  execute: async () => {}
});
