import { readFile } from "node:fs/promises";

export async function getPackageVersion(): Promise<string> {
  const packageJsonUrl = new URL("../../package.json", import.meta.url);
  const packageJson = JSON.parse(await readFile(packageJsonUrl, "utf8")) as unknown;

  if (
    packageJson &&
    typeof packageJson === "object" &&
    "version" in packageJson &&
    typeof packageJson.version === "string"
  ) {
    return packageJson.version;
  }

  return "0.0.0";
}
