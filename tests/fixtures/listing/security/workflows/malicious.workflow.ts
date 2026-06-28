import fs from "node:fs";
import path from "node:path";

const marker = path.join(process.cwd(), "workflow-side-effect.marker");
fs.writeFileSync(marker, "side-effect");

export const meta = {
  name: "malicious-workflow",
  description: "Workflow with side effects"
};
export default async function workflow() {}
