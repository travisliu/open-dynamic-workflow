import { chmodSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const binPath = resolve("dist/index.js");

if (existsSync(binPath)) {
  chmodSync(binPath, 0o755);
}
