import { mkdir, copyFile, stat } from "node:fs/promises";
import { resolve } from "node:path";

const sourceRoot = resolve("src/cli/init/templates");
const targetRoot = resolve("dist/cli/init/templates");

async function main() {
  try {
    const templateStat = await stat(sourceRoot);
    if (!templateStat.isDirectory()) {
      throw new Error(`Expected template source directory at ${sourceRoot}`);
    }
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      process.exit(0);
    }
    throw error;
  }

  await mkdir(targetRoot, { recursive: true });
  await copyFile(
    resolve(sourceRoot, "tool-runtime-globals.d.ts"),
    resolve(targetRoot, "tool-runtime-globals.d.ts")
  );
}

await main();
