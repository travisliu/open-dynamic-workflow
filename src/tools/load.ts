import { readdir, readFile, stat, mkdtemp, rm, writeFile, mkdir, realpath } from "node:fs/promises";
import { join, resolve, extname, dirname, relative, isAbsolute } from "node:path";
import { pathToFileURL } from "node:url";
import * as ts from "typescript";
import { BrandedToolDefinition, ToolRegistry } from "../types/tool.js";
import { buildToolRegistry } from "./registry.js";
import { isDefinedTool } from "./define-tool.js";
import { OpenDynamicWorkflowError } from "../errors/types.js";
import { ErrorCode } from "../errors/codes.js";
import type { ResourceDiscoveryPatterns } from "../discovery/types.js";
import { collectResourceCandidateFiles } from "../discovery/collect-files.js";
import { matchGlob } from "../discovery/file-patterns.js";
import type { ConfigDiagnostic } from "../config/types.js";

export interface LoadToolRegistryInput {
  cwd: string;
  dir?: string;
  discovery?: ResourceDiscoveryPatterns;
  candidateFiles?: string[];
  maxDefinitions: number;
  configDiagnostics?: ConfigDiagnostic[];
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

async function mirrorDirectory(
  srcDir: string,
  destDir: string,
  cwd: string,
  excludePatterns: string[]
): Promise<void> {
  const entries = await readdir(srcDir, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = join(srcDir, entry.name);
    const destPath = join(destDir, entry.name);

    if (entry.isDirectory()) {
      await mkdir(destPath, { recursive: true });
      await mirrorDirectory(srcPath, destPath, cwd, excludePatterns);
    } else if (entry.isFile()) {
      const relPath = relative(cwd, srcPath).replace(/\\/g, "/");
      let isExcluded = false;
      for (const exc of excludePatterns) {
        if (matchGlob(relPath, exc)) {
          isExcluded = true;
          break;
        }
      }
      if (isExcluded) {
        continue;
      }

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
  const { cwd, maxDefinitions } = input;
  const realCwd = resolve(cwd);

  const discoveredFiles: string[] = [];

  if (input.candidateFiles) {
    for (const f of input.candidateFiles) {
      const fullPath = resolve(realCwd, f);
      try {
        const realTarget = await realpath(fullPath);
        const relativeToCwd = relative(realCwd, realTarget);
        if (relativeToCwd.startsWith("..") || isAbsolute(relativeToCwd)) {
          throw new OpenDynamicWorkflowError(
            ErrorCode.SECURITY_POLICY_VIOLATION,
            `Tool symlink '${fullPath}' points outside the workspace.`
          );
        }
        discoveredFiles.push(realTarget);
      } catch (err) {
        if (err instanceof OpenDynamicWorkflowError) throw err;
        discoveredFiles.push(fullPath);
      }
    }
  } else if (input.discovery) {
    const res = await collectResourceCandidateFiles({
      cwd,
      resourceType: "tool",
      include: input.discovery.include,
      exclude: input.discovery.exclude,
      compatibilityMode: input.discovery.compatibilityMode,
      includeSource: input.discovery.includeSource,
      excludeSource: input.discovery.excludeSource,
      strict: false,
    });
    if (res.configDiagnostics && input.configDiagnostics) {
      input.configDiagnostics.push(...res.configDiagnostics);
    }
    const escapeDiag = res.configDiagnostics.find(d => d.code === "CONFIG_PATH_SYMLINK_ESCAPE");
    if (escapeDiag) {
      throw new OpenDynamicWorkflowError(
        ErrorCode.SECURITY_POLICY_VIOLATION,
        `Tool symlink '${resolve(realCwd, escapeDiag.value as string)}' points outside the workspace.`
      );
    }
    for (const file of res.files) {
      discoveredFiles.push(file.absolutePath);
    }
  } else if (input.dir) {
    const absoluteDir = resolve(realCwd, input.dir);
    try {
      const dirStat = await stat(absoluteDir);
      if (dirStat.isDirectory()) {
        const files = await readdir(absoluteDir, { withFileTypes: true });
        const entries = files
          .filter(f => f.isFile() && SUPPORTED_EXTENSIONS.includes(extname(f.name)))
          .map(f => f.name)
          .sort();
        for (const name of entries) {
          discoveredFiles.push(join(absoluteDir, name));
        }
      }
    } catch (err: any) {
      if (err.code !== "ENOENT") {
        throw new OpenDynamicWorkflowError(
          "TOOL_INVALID_DEFINITION" as any,
          `Failed to read tools directory '${absoluteDir}': ${err.message}`
        );
      }
    }
  }

  const definitions: Array<{ definition: BrandedToolDefinition; sourcePath: string }> = [];
  let tempDir: string | undefined;
  const projectTmpDir = join(realCwd, ".open-dynamic-workflow", "tmp");

  try {
    await mkdir(projectTmpDir, { recursive: true });
    tempDir = await mkdtemp(join(projectTmpDir, "tools-"));

    const excludePatterns = input.discovery?.exclude || [];
    const mirroredDirs = new Set<string>();
    for (const filePath of discoveredFiles) {
      const srcDir = dirname(filePath);
      if (!mirroredDirs.has(srcDir)) {
        mirroredDirs.add(srcDir);
        const relDir = relative(realCwd, srcDir);
        const destDir = join(tempDir, relDir);
        await mkdir(destDir, { recursive: true });
        await mirrorDirectory(srcDir, destDir, realCwd, excludePatterns);
      }
    }

    for (const filePath of discoveredFiles) {
      const ext = extname(filePath);
      const relPath = relative(realCwd, filePath);
      let tempFilePath = join(tempDir, relPath);
      if (ext === ".ts") {
        tempFilePath = tempFilePath.replace(/\.ts$/, ".mjs");
      }

      let module;
      try {
        module = await import(pathToFileURL(tempFilePath).href);
      } catch (err: any) {
        throw new OpenDynamicWorkflowError(
          ErrorCode.TOOL_INVALID_DEFINITION,
          `Failed to load tool definition from '${filePath}': ${err.message}`,
          { cause: err }
        );
      }
      const definition = module.default;

      if (!isDefinedTool(definition)) {
        throw new OpenDynamicWorkflowError(
          "TOOL_INVALID_DEFINITION" as any,
          `Tool file '${filePath}' does not have a valid default export created with defineTool().`
        );
      }

      definitions.push({ definition, sourcePath: filePath });
    }
  } catch (err: any) {
    if (err instanceof OpenDynamicWorkflowError) throw err;
    throw new OpenDynamicWorkflowError(
      "TOOL_INVALID_DEFINITION" as any,
      `Failed to load tool definition: ${err.message}`
    );
  } finally {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true }).catch(() => {});
      try {
        const tmpFiles = await readdir(projectTmpDir);
        if (tmpFiles.length === 0) {
          await rm(projectTmpDir, { recursive: true }).catch(() => {});
          const parentDir = join(realCwd, ".open-dynamic-workflow");
          const parentFiles = await readdir(parentDir);
          if (parentFiles.length === 0) {
            await rm(parentDir, { recursive: true }).catch(() => {});
          }
        }
      } catch {}
    }
  }

  return buildToolRegistry({ definitions, maxDefinitions });
}
