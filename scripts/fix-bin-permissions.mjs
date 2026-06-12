import { chmodSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const binPath = resolve("dist/bin/openflow.js");

if (existsSync(binPath)) {
  chmodSync(binPath, 0o755);
}
