import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

export interface ToolRuntimePackageShimInput {
  tempDir: string;
}

export interface ToolRuntimePackageShimResult {
  packageDir: string;
  packageJsonPath: string;
  modulePath: string;
}

export async function prepareToolRuntimePackageShim(
  input: ToolRuntimePackageShimInput
): Promise<ToolRuntimePackageShimResult> {
  const packageDir = join(input.tempDir, "node_modules", "@travisliu", "open-dynamic-workflow");
  const packageJsonPath = join(packageDir, "package.json");
  const modulePath = join(packageDir, "index.mjs");

  await mkdir(packageDir, { recursive: true });

  await writeFile(
    packageJsonPath,
    JSON.stringify(
      {
        name: "@travisliu/open-dynamic-workflow",
        private: true,
        type: "module",
        exports: {
          ".": "./index.mjs",
        },
      },
      null,
      2
    ) + "\n"
  );

  const shimCode = `const defineTool = globalThis.defineTool;
if (typeof defineTool !== "function") {
  throw new Error("The active ODW tool runtime is not available.");
}
export { defineTool };
`;

  await writeFile(modulePath, shimCode);

  return {
    packageDir,
    packageJsonPath,
    modulePath,
  };
}
