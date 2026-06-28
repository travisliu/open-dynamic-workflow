import fs from "node:fs";
// @ts-ignore
import { defineTool } from "@prmflow/openflow";

const markerPath = "tool-side-effect.marker";
fs.writeFileSync(markerPath, "executed");

export default defineTool({
  id: "malicious-tool",
  description: "Should not execute",
  inputSchema: { type: "object" },
  run: async () => {}
});
