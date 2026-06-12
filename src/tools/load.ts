import { readdir, readFile, stat, mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { join, resolve, extname, dirname, relative } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import * as ts from "typescript";
import { BrandedToolDefinition, ToolRegistry } from "../types/tool.js";
import { buildToolRegistry } from "./registry.js";
import { isDefinedTool } from "./define-tool.js";
import { OpenFlowError } from "../errors/types.js";

export interface LoadToolRegistryInput {
  cwd: string;
  dir: string;
  maxDefinitions: number;
}

const SUPPORTED_EXTENSIONS = [".ts", ".js", ".mjs", ".cjs"];

function rewriteRelativeSpecifiers(code: string, isTypeScript: boolean): string {
  const rewrite = (specifier: string) => {
    let newSpecifier = specifier;
    if (newSpecifier.endsWith(".ts")) {
      newSpecifier = newSpecifier.replace(/\.ts$/, ".mjs");
    } else if (newSpecifier.endsWith(".js")) {
      if (isTypeScript) {
        newSpecifier = newSpecifier.replace(/\.js$/, ".mjs");
      }
    } else if (!newSpecifier.endsWith(".mjs") && !newSpecifier.endsWith(".cjs")) {
      if (isTypeScript) {
        newSpecifier = newSpecifier + ".mjs";
      }
    }
    return newSpecifier;
  };

  let output = code.replace(
    /(import|export)\s+(.*?)\s+from\s+['"](\.\.?\/.*?)['"]/g,
    (match, keyword, imports, specifier) => {
      return `${keyword} ${imports} from '${rewrite(specifier)}'`;
    }
  );

  output = output.replace(
    /import\s+['"](\.\.?\/.*?)['"]/g,
    (match, specifier) => {
      return `import '${rewrite(specifier)}'`;
    }
  );

  return output;
}

async function mirrorDirectory(srcDir: string, destDir: string): Promise<void> {
  const entries = await readdir(srcDir, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = join(srcDir, entry.name);
    const destPath = join(destDir, entry.name);

    if (entry.isDirectory()) {
      await mkdir(destPath, { recursive: true });
      await mirrorDirectory(srcPath, destPath);
    } else if (entry.isFile()) {
      const ext = extname(entry.name);
      if (ext === ".ts") {
        const sourceText = await readFile(srcPath, "utf8");
        const transpiled = ts.transpileModule(sourceText, {
          compilerOptions: {
            target: ts.ScriptTarget.ESNext,
            module: ts.ModuleKind.ESNext,
            moduleResolution: ts.ModuleResolutionKind.Node10,
            esModuleInterop: true,
          },
          fileName: entry.name
        });

        const outputText = rewriteRelativeSpecifiers(transpiled.outputText, true);
        const destMjsPath = destPath.replace(/\.ts$/, ".mjs");
        await mkdir(dirname(destMjsPath), { recursive: true });
        await writeFile(destMjsPath, outputText);
      } else if (SUPPORTED_EXTENSIONS.includes(ext)) {
        let content = await readFile(srcPath, "utf8");
        if (ext === ".js" || ext === ".mjs") {
          content = rewriteRelativeSpecifiers(content, false);
        }
        await mkdir(dirname(destPath), { recursive: true });
        await writeFile(destPath, content);
      }
    }
  }
}

export async function loadToolRegistry(input: LoadToolRegistryInput): Promise<ToolRegistry> {
  const { cwd, dir, maxDefinitions } = input;
  const absoluteDir = resolve(cwd, dir);

  let entries: string[] = [];
  try {
    const dirStat = await stat(absoluteDir);
    if (!dirStat.isDirectory()) {
      throw new Error("Not a directory");
    }
    const files = await readdir(absoluteDir, { withFileTypes: true });
    entries = files
      .filter(f => f.isFile() && SUPPORTED_EXTENSIONS.includes(extname(f.name)))
      .map(f => f.name)
      .sort();
  } catch (err: any) {
    if (err.code === "ENOENT") {
      return buildToolRegistry({ definitions: [], maxDefinitions });
    }
    throw new OpenFlowError(
      "TOOL_INVALID_DEFINITION" as any,
      `Failed to read tools directory '${absoluteDir}': ${err.message}`
    );
  }

  const definitions: Array<{ definition: BrandedToolDefinition; sourcePath: string }> = [];
  let tempDir: string | undefined;

  try {
    const projectTmpDir = join(cwd, ".openflow", "tmp");
    await mkdir(projectTmpDir, { recursive: true });
    tempDir = await mkdtemp(join(projectTmpDir, "tools-"));
    await mirrorDirectory(absoluteDir, tempDir);

    for (const fileName of entries) {
      const filePath = join(absoluteDir, fileName);
      const ext = extname(fileName);
      let definition: any;

      if (ext === ".ts") {
        const tempFilePath = join(tempDir, fileName.replace(/\.ts$/, ".mjs"));
        const module = await import(pathToFileURL(tempFilePath).href);
        definition = module.default;
      } else {
        const tempFilePath = join(tempDir, fileName);
        const module = await import(pathToFileURL(tempFilePath).href);
        definition = module.default;
      }

      if (!isDefinedTool(definition)) {
        throw new OpenFlowError(
          "TOOL_INVALID_DEFINITION" as any,
          `Tool file '${filePath}' does not have a valid default export created with defineTool().`
        );
      }

      definitions.push({ definition, sourcePath: filePath });
    }
  } catch (err: any) {
    if (err instanceof OpenFlowError) throw err;
    throw new OpenFlowError(
      "TOOL_INVALID_DEFINITION" as any,
      `Failed to load tool definition: ${err.message}`
    );
  } finally {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true }).catch(() => {});
    }
  }

  return buildToolRegistry({ definitions, maxDefinitions });
}
