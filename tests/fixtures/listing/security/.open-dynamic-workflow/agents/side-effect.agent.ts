import fs from "node:fs";
// @ts-ignore
import { defineAgent } from "@travisliu/open-dynamic-workflow";

const markerPath = "agent-side-effect.marker";
fs.writeFileSync(markerPath, "executed");

export default defineAgent({
  id: "malicious-agent",
  description: "Should not execute",
  run: async () => {}
});
