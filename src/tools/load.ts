import { readdir, readFile, stat, mkdtemp, rm, writeFile, mkdir, realpath } from "node:fs/promises";
import { join, resolve, extname, dirname, relative, isAbsolute } from "node:path";
import { pathToFileURL } from "node:url";
import * as ts from "typescript";
import { BrandedToolDefinition, ToolRegistry } from "../types/tool.js";
import { buildToolRegistry } from "./registry.js";
import { isDefinedTool } from "./define-tool.js";
import { OpenDynamicWorkflowError } from "../errors/types.js";
import { ErrorCode } from "../errors/codes.js";
import type { PrecollectedResourceLoadInput } from "../discovery/types.js";
import { isExcludedByDiscoveryPolicy } from "../discovery/index.js";
import type { CompiledDiscoveryPattern } from "../discovery/compile-patterns.js";
import type { ConfigDiagnostic } from "../config/types.js";

export interface LoadToolRegistryInput {
  cwd: string;
  dir?: string;
  precollected?: PrecollectedResourceLoadInput;
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

async function assertPathInsideCwd(realCwd: string, candidatePath: string, message: string): Promise<string> {
  const resolved = resolve(realCwd, candidatePath);
  const real = await realpath(resolved);
  const relativeToCwd = relative(realCwd, real);
  if (relativeToCwd.startsWith("..") || isAbsolute(relativeToCwd)) {
    throw new OpenDynamicWorkflowError(
      ErrorCode.SECURITY_POLICY_VIOLATION,
      message
    );
  }
  return real;
}

function resolveToolLoadExcludePatterns(input: LoadToolRegistryInput, cwd: string): CompiledDiscoveryPattern[] {
  if (input.precollected) {
    return input.precollected.discoveryPolicy.exclude;
  }

  return [];
}

async function mirrorDirectory(
  srcDir: string,
  destDir: string,
  cwd: string,
  excludePatterns: CompiledDiscoveryPattern[]
): Promise<void> {
  const entries = await readdir(srcDir, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = join(srcDir, entry.name);
    const destPath = join(destDir, entry.name);

    // Enforce CWD containment on mirrored helpers
    await assertPathInsideCwd(cwd, srcPath, `Tool path '${srcPath}' points outside the workspace.`);

    // Enforce excludes on mirrored helpers
    const relPath = relative(cwd, srcPath).replace(/\\/g, "/");
    if (isExcludedByDiscoveryPolicy(relPath, excludePatterns)) {
      continue;
    }

    if (entry.isDirectory()) {
      await mkdir(destPath, { recursive: true });
      await mirrorDirectory(srcPath, destPath, cwd, excludePatterns);
    } else if (entry.isFile() || entry.isSymbolicLink()) {
      let realTarget = srcPath;
      try {
        realTarget = await realpath(srcPath);
      } catch {}
      const targetStats = await stat(realTarget);
      if (targetStats.isDirectory()) {
        await mkdir(destPath, { recursive: true });
        await mirrorDirectory(realTarget, destPath, cwd, excludePatterns);
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

  const excludePatterns = resolveToolLoadExcludePatterns(input, realCwd);

  const discoveredFiles: string[] = [];

  if (input.precollected) {
    const toolCandidates = input.precollected.candidateFiles
      .filter(c => c.resourceType === "tool")
      .slice()
      .sort((a, b) => a.relativePath.localeCompare(b.relativePath));

    for (const candidate of toolCandidates) {
      const fullPath = resolve(realCwd, candidate.realPath || candidate.absolutePath);
      await assertPathInsideCwd(realCwd, fullPath, `Tool path '${fullPath}' points outside the workspace.`);
      discoveredFiles.push(fullPath);
    }
  } else if (input.dir) {
    // Legacy direct API compatibility path: dir input
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

    const fileExists = async (p: string): Promise<boolean> => {
      try {
        const s = await stat(p);
        return s.isFile();
      } catch {
        return false;
      }
    };

    const resolveSpecifierPath = async (dir: string, specifier: string): Promise<string | undefined> => {
      const resolved = resolve(dir, specifier);
      if (await fileExists(resolved)) return resolved;
      if (specifier.endsWith(".js")) {
        const tsPath = resolved.slice(0, -3) + ".ts";
        if (await fileExists(tsPath)) return tsPath;
      } else if (specifier.endsWith(".mjs")) {
        const tsPath = resolved.slice(0, -4) + ".ts";
        if (await fileExists(tsPath)) return tsPath;
      } else if (specifier.endsWith(".cjs")) {
        const tsPath = resolved.slice(0, -4) + ".ts";
        if (await fileExists(tsPath)) return tsPath;
      }
      for (const ext of [".ts", ".js", ".mjs", ".cjs"]) {
        const pathWithExt = resolved + ext;
        if (await fileExists(pathWithExt)) return pathWithExt;
      }
      return undefined;
    };

    const inspected = new Set<string>();
    const inspectImportsRecursive = async (filePath: string): Promise<void> => {
      let realFilePath = filePath;
      try {
        realFilePath = await realpath(filePath);
      } catch {}

      if (inspected.has(realFilePath)) return;
      inspected.add(realFilePath);

      let content: string;
      try {
        content = await readFile(realFilePath, "utf8");
      } catch (err: any) {
        throw new OpenDynamicWorkflowError(
          ErrorCode.TOOL_INVALID_DEFINITION,
          `Failed to read file '${realFilePath}' for static import inspection: ${err.message}`
        );
      }

      const sourceFile = ts.createSourceFile(
        realFilePath,
        content,
        ts.ScriptTarget.Latest,
        true
      );

      const dir = dirname(realFilePath);
      for (const statement of sourceFile.statements) {
        if (ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement)) {
          if (statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier)) {
            const specifier = statement.moduleSpecifier.text;
            if (specifier.startsWith(".") || specifier.startsWith("..")) {
              const resolvedTarget = await resolveSpecifierPath(dir, specifier);
              if (resolvedTarget) {
                const realTarget = await realpath(resolvedTarget);
                const relativeToCwd = relative(realCwd, realTarget);
                if (relativeToCwd.startsWith("..") || isAbsolute(relativeToCwd)) {
                  throw new OpenDynamicWorkflowError(
                    ErrorCode.SECURITY_POLICY_VIOLATION,
                    `Relative import '${specifier}' in '${filePath}' resolves to '${realTarget}' which points outside the workspace.`
                  );
                }

                const relPath = relative(realCwd, realTarget).replace(/\\/g, "/");
                if (isExcludedByDiscoveryPolicy(relPath, excludePatterns)) {
                  throw new OpenDynamicWorkflowError(
                    ErrorCode.SECURITY_POLICY_VIOLATION,
                    `Relative import '${specifier}' in '${filePath}' resolves to '${realTarget}' which is excluded by policy.`
                  );
                }

                await inspectImportsRecursive(realTarget);
              }
            }
          }
        }
      }
    };

    for (const filePath of discoveredFiles) {
      await inspectImportsRecursive(filePath);
    }

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
