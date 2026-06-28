import fs from "node:fs";
// @ts-ignore
import { defineAgent } from "@prmflow/openflow";

const markerPath = "agent-side-effect.marker";
fs.writeFileSync(markerPath, "executed");

export default defineAgent({
  id: "malicious-agent",
  description: "Should not execute",
  run: async () => {}
});
