import { promises as fs } from "node:fs";
import { resolve, relative, join, sep, isAbsolute } from "node:path";
import { 
  CandidateFile, 
  DiscoveryDirectories, 
  ListDiagnostic, 
  ListResourceType,
  DiscoveryPatterns
} from "./types.js";
import { 
  listDiagnostic, 
  normalizeDiagnosticSeverity,
  LIST_DIRECTORY_NOT_FOUND, 
  LIST_FILE_UNREADABLE 
} from "./diagnostics.js";
import { walk, matchGlob, getGlobBaseDir } from "./file-patterns.js";
import type { DiscoveryCompatibilityMode, DiscoveryConfigSource, ConfigDiagnostic, DiscoveryResource } from "../config/types.js";
import { checkMatchedFileSafety } from "../config/path-safety.js";

function mapResourceTypeToDiscoveryResource(rt: ListResourceType): DiscoveryResource {
  if (rt === "agent") return "sharedAgents";
  if (rt === "tool") return "tools";
  return "workflow";
}

function basenamePosix(relativePath: string): string {
  const normalized = relativePath.replace(/\\/g, "/");
  return normalized.split("/").pop() ?? normalized;
}

function sourcePatternAllowsGenericRuntimeFiles(input: {
  resourceType: ListResourceType;
  compatibilityMode: DiscoveryCompatibilityMode;
  sourcePattern: string;
}): boolean {
  const { resourceType, compatibilityMode, sourcePattern } = input;
  if (compatibilityMode === "legacy-compatible" || compatibilityMode === "cli-dir-compatible") {
    return true;
  }
  if (resourceType !== "workflow") {
    return false;
  }

  const marker = resourceType === "workflow" ? ".workflow." : resourceType === "agent" ? ".agent." : ".tool.";
  const basename = basenamePosix(sourcePattern);
  if (basename.includes(marker)) {
    return false;
  }

  return [".ts", ".js", ".mjs", ".cjs"].some(ext => basename.endsWith(ext));
}

function diagnosticPatternLabel(input: {
  resourceType: ListResourceType;
  compatibilityMode: DiscoveryCompatibilityMode;
  pattern: string;
}): string {
  const { resourceType, compatibilityMode, pattern } = input;
  if (compatibilityMode !== "default-suffix-specific") {
    return pattern;
  }

  const marker = resourceType === "workflow" ? ".workflow" : resourceType === "agent" ? ".agent" : ".tool";
  for (const ext of [".ts", ".js", ".mjs", ".cjs"]) {
    const suffix = `${marker}${ext}`;
    if (pattern.endsWith(suffix)) {
      return `${pattern.slice(0, -suffix.length)}${ext}`;
    }
  }

  return pattern;
}

function shouldEmitIncludeMatchedNothing(source: DiscoveryConfigSource): boolean {
  return source !== "default";
}

function shouldEmitExcludeMatchedNothing(source: DiscoveryConfigSource): boolean {
  return source === "new" || source === "legacy-discovery";
}

export async function collectResourceCandidateFiles(input: {
  cwd: string;
  resourceType: ListResourceType;
  include: string[];
  exclude: string[];
  compatibilityMode: DiscoveryCompatibilityMode;
  includeSource?: DiscoveryConfigSource | undefined;
  excludeSource?: DiscoveryConfigSource | undefined;
  strict: boolean;
}): Promise<{ files: CandidateFile[]; diagnostics: ListDiagnostic[]; configDiagnostics: ConfigDiagnostic[] }> {
  const { cwd, resourceType, include, exclude, compatibilityMode, strict } = input;
  const files: CandidateFile[] = [];
  const diagnostics: ListDiagnostic[] = [];
  const configDiagnostics: ConfigDiagnostic[] = [];

  const absoluteCwd = resolve(cwd);
  const supportedExtensions = [".ts", ".js", ".mjs", ".cjs"];
  const seenPaths = new Set<string>();

  const discoveryResource = mapResourceTypeToDiscoveryResource(resourceType);
  const includeSource = input.includeSource ?? (compatibilityMode === "default-suffix-specific" ? "default" : "new");
  const excludeSource = input.excludeSource ?? (compatibilityMode === "default-suffix-specific" ? "default" : "new");
  const missingBases = new Set<string>();
  const notDirectoryBases = new Set<string>();

  const includeMatchedCount = new Map<string, number>();
  for (const inc of include) {
    includeMatchedCount.set(inc, 0);
  }
  const excludeMatchedCount = new Map<string, number>();
  for (const exc of exclude) {
    excludeMatchedCount.set(exc, 0);
  }

  async function tryAddCandidate(absolutePath: string, relativePathToReport: string, sourcePattern: string) {
    let suffixMatches = sourcePatternAllowsGenericRuntimeFiles({ resourceType, compatibilityMode, sourcePattern });
    if (!suffixMatches) {
      const marker = resourceType === "workflow" ? ".workflow." : resourceType === "agent" ? ".agent." : ".tool.";
      suffixMatches = basenamePosix(relativePathToReport).includes(marker);
    }

    if (!suffixMatches) return;

    let isExcluded = false;
    for (const exc of exclude) {
      if (matchGlob(relativePathToReport, exc)) {
        isExcluded = true;
        excludeMatchedCount.set(exc, (excludeMatchedCount.get(exc) || 0) + 1);
      }
    }
    if (isExcluded) return;

    const safetyResult = await checkMatchedFileSafety({
      cwd: absoluteCwd,
      resource: discoveryResource,
      path: `${discoveryResource}.include`,
      filePath: relativePathToReport,
      source: compatibilityMode === "cli-dir-compatible" ? "cli-override" : "new",
    });

    if (safetyResult.diagnostics && safetyResult.diagnostics.length > 0) {
      configDiagnostics.push(...safetyResult.diagnostics);
      return;
    }

    const targetPath = safetyResult.realPath || absolutePath;
    const realStats = await fs.stat(targetPath);
    if (!realStats.isFile()) return;

    if (seenPaths.has(targetPath)) return;
    seenPaths.add(targetPath);

    includeMatchedCount.set(sourcePattern, (includeMatchedCount.get(sourcePattern) || 0) + 1);

    files.push({
      resourceType,
      absolutePath: targetPath,
      relativePath: relativePathToReport,
      realPath: targetPath,
      sourcePattern,
    });
  }

  for (const pattern of include) {
    if (!pattern.includes("*")) {
      const globPattern = isAbsolute(pattern) ? relative(absoluteCwd, pattern) : pattern;
      const resolvedPath = resolve(absoluteCwd, globPattern);
      const relativePathToReport = globPattern.split(sep).join("/");
      try {
        const stats = await fs.stat(resolvedPath);
        if (stats.isDirectory()) {
          if (!notDirectoryBases.has(relativePathToReport)) {
            notDirectoryBases.add(relativePathToReport);
            diagnostics.push(normalizeDiagnosticSeverity(listDiagnostic({
              resourceType,
              code: LIST_FILE_UNREADABLE,
              message: `Path is not a directory: ${pattern}`,
              path: pattern,
            }), strict));
          }
          continue;
        }

        const hasSupportedExtension = supportedExtensions.some(ext => resolvedPath.endsWith(ext));
        if (!hasSupportedExtension) {
          continue;
        }

        await tryAddCandidate(resolvedPath, relativePathToReport, pattern);
      } catch (err: any) {
        if (err.code === "ENOENT") {
          if (!missingBases.has(relativePathToReport)) {
            missingBases.add(relativePathToReport);
            diagnostics.push(normalizeDiagnosticSeverity(listDiagnostic({
              resourceType,
              code: LIST_DIRECTORY_NOT_FOUND,
              message: `Directory not found: ${pattern}`,
              path: pattern,
            }), strict));
          }
        } else {
          diagnostics.push(normalizeDiagnosticSeverity(listDiagnostic({
            resourceType,
            code: LIST_FILE_UNREADABLE,
            message: `Could not read file: ${pattern} (${err.message})`,
            path: pattern,
          }), strict));
        }
      }
      continue;
    }

    let baseDir = getGlobBaseDir(pattern);
    if (baseDir.startsWith("./")) {
      baseDir = baseDir.slice(2);
    }
    const absoluteBaseDir = resolve(absoluteCwd, baseDir);
    const globPattern = isAbsolute(pattern) ? relative(absoluteCwd, pattern) : pattern;

    try {
      const stats = await fs.stat(absoluteBaseDir);
      if (!stats.isDirectory()) {
        if (!notDirectoryBases.has(baseDir)) {
          notDirectoryBases.add(baseDir);
          diagnostics.push(normalizeDiagnosticSeverity(listDiagnostic({
            resourceType,
            code: LIST_FILE_UNREADABLE,
            message: `Path is not a directory: ${baseDir}`,
            path: baseDir,
          }), strict));
        }
        continue;
      }

      const escapedSymlink = await checkSymlinkEscapes(absoluteBaseDir, absoluteCwd);
      if (escapedSymlink) {
        const relativePathToReport = relative(absoluteCwd, escapedSymlink).split(sep).join("/");
        configDiagnostics.push({
          resource: discoveryResource,
          path: `${discoveryResource}.include`,
          severity: "error",
          code: "CONFIG_PATH_SYMLINK_ESCAPE",
          message: `A matched ${discoveryResource} file resolves through a symlink outside cwd and will not be loaded.`,
          value: relativePathToReport,
          fatalInStrictContext: true,
        });
      }

      for await (const p of walk(absoluteBaseDir)) {
        const hasSupportedExtension = supportedExtensions.some(ext => p.endsWith(ext));
        if (!hasSupportedExtension) continue;

        const relPath = relative(absoluteCwd, p);
        if (matchGlob(relPath, globPattern)) {
          const relativePathToReport = relPath.split(sep).join("/");
          try {
            await tryAddCandidate(p, relativePathToReport, pattern);
          } catch {
            diagnostics.push(normalizeDiagnosticSeverity(listDiagnostic({
              resourceType,
              code: LIST_FILE_UNREADABLE,
              message: `Could not read file or resolve symlink: ${p}`,
              path: relativePathToReport,
            }), strict));
          }
        }
      }
    } catch (err: any) {
      if (err.code === "ENOENT") {
        if (!missingBases.has(baseDir)) {
          missingBases.add(baseDir);
          diagnostics.push(normalizeDiagnosticSeverity(listDiagnostic({
            resourceType,
            code: LIST_DIRECTORY_NOT_FOUND,
            message: `Directory not found: ${baseDir}`,
            path: baseDir,
          }), strict));
        }
      } else {
        diagnostics.push(normalizeDiagnosticSeverity(listDiagnostic({
          resourceType,
          code: LIST_FILE_UNREADABLE,
          message: `Error reading directory: ${baseDir} (${err.message})`,
          path: baseDir,
        }), strict));
      }
    }
  }

  for (const [inc, count] of includeMatchedCount.entries()) {
    if (count === 0 && shouldEmitIncludeMatchedNothing(includeSource)) {
      const label = diagnosticPatternLabel({ resourceType, compatibilityMode, pattern: inc });
      configDiagnostics.push({
        resource: discoveryResource,
        path: `${discoveryResource}.include[${include.indexOf(inc)}]`,
        severity: "warning",
        code: "CONFIG_PATH_INCLUDE_MATCHED_NOTHING",
        message: `Include pattern '${label}' did not match any files.`,
        value: label,
        fatalInStrictContext: false,
      });
    }
  }

  for (const [exc, count] of excludeMatchedCount.entries()) {
    if (count === 0 && shouldEmitExcludeMatchedNothing(excludeSource)) {
      const label = diagnosticPatternLabel({ resourceType, compatibilityMode, pattern: exc });
      configDiagnostics.push({
        resource: discoveryResource,
        path: `${discoveryResource}.exclude[${exclude.indexOf(exc)}]`,
        severity: "warning",
        code: "CONFIG_PATH_EXCLUDE_MATCHED_NOTHING",
        message: `Exclude pattern '${label}' did not match any files or was redundant.`,
        value: label,
        fatalInStrictContext: false,
      });
    }
  }

  files.sort((a, b) => a.relativePath.localeCompare(b.relativePath));

  return { files, diagnostics, configDiagnostics };
}

export async function collectCandidateFiles(input: {
  cwd: string;
  resourceTypes: ListResourceType[];
  directories?: DiscoveryDirectories;
  patterns?: DiscoveryPatterns;
  strict: boolean;
}): Promise<{ files: CandidateFile[]; diagnostics: ListDiagnostic[]; configDiagnostics?: ConfigDiagnostic[] }> {
  const { cwd, resourceTypes, directories, patterns, strict } = input;

  if (patterns) {
    const files: CandidateFile[] = [];
    const diagnostics: ListDiagnostic[] = [];
    const configDiagnostics: ConfigDiagnostic[] = [];

    for (const resourceType of resourceTypes) {
      const patternObj = patterns[resourceType];
      if (!patternObj) continue;
      const res = await collectResourceCandidateFiles({
        cwd,
        resourceType,
        include: patternObj.include,
        exclude: patternObj.exclude,
        compatibilityMode: patternObj.compatibilityMode,
        includeSource: patternObj.includeSource,
        excludeSource: patternObj.excludeSource,
        strict,
      });
      files.push(...res.files);
      diagnostics.push(...res.diagnostics);
      configDiagnostics.push(...res.configDiagnostics);
    }

    files.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
    return { files, diagnostics, configDiagnostics };
  }

  // Fallback to legacy directories scanning
  const files: CandidateFile[] = [];
  const diagnostics: ListDiagnostic[] = [];

  const absoluteCwd = resolve(cwd);
  const supportedExtensions = [".ts", ".js", ".mjs", ".cjs"];
  const seenPaths = new Set<string>();

  for (const resourceType of resourceTypes) {
    if (resourceType === "workflow") {
      if (!directories) continue;
      const includePatterns = directories.workflowInclude;
      for (const pattern of includePatterns) {
        let baseDir = getGlobBaseDir(pattern);
        if (baseDir.startsWith("./")) {
          baseDir = baseDir.slice(2);
        }
        const absoluteBaseDir = resolve(absoluteCwd, baseDir);
        const globPattern = isAbsolute(pattern) ? relative(absoluteCwd, pattern) : pattern;

        try {
          const stats = await fs.stat(absoluteBaseDir);
          if (!stats.isDirectory()) {
            diagnostics.push(normalizeDiagnosticSeverity(listDiagnostic({
              resourceType,
              code: LIST_FILE_UNREADABLE,
              message: `Path is not a directory: ${baseDir}`,
              path: baseDir,
            }), strict));
            continue;
          }

          for await (const p of walk(absoluteBaseDir)) {
            const hasSupportedExtension = supportedExtensions.some(ext => p.endsWith(ext));
            if (!hasSupportedExtension) continue;

            const relPath = relative(absoluteCwd, p);
            if (matchGlob(relPath, globPattern)) {
              const relativePathToReport = relPath.split(sep).join("/");
              
              try {
                const linkStats = await fs.lstat(p);
                let targetPath = p;
                if (linkStats.isSymbolicLink()) {
                  targetPath = await fs.realpath(p);
                  const relativeToCwd = relative(absoluteCwd, targetPath);

                  if (relativeToCwd.startsWith("..") || isAbsolute(relativeToCwd)) {
                     diagnostics.push(normalizeDiagnosticSeverity(listDiagnostic({
                      resourceType,
                      code: LIST_FILE_UNREADABLE,
                      message: `Symlink target is outside workspace root: ${p}`,
                      path: relativePathToReport,
                    }), strict));
                    continue;
                  }
                }

                const realStats = await fs.stat(targetPath);
                if (!realStats.isFile()) continue;

                if (seenPaths.has(p)) continue;
                seenPaths.add(p);

                files.push({
                  resourceType,
                  absolutePath: targetPath,
                  relativePath: relativePathToReport,
                  realPath: targetPath,
                  sourcePattern: pattern,
                });
              } catch {
                diagnostics.push(normalizeDiagnosticSeverity(listDiagnostic({
                  resourceType,
                  code: LIST_FILE_UNREADABLE,
                  message: `Could not read file or resolve symlink: ${p}`,
                  path: relativePathToReport,
                }), strict));
              }
            }
          }
        } catch (err: any) {
          if (err.code === "ENOENT") {
            diagnostics.push(normalizeDiagnosticSeverity(listDiagnostic({
              resourceType,
              code: LIST_DIRECTORY_NOT_FOUND,
              message: `Directory not found: ${baseDir}`,
              path: baseDir,
            }), strict));
          } else {
            diagnostics.push(normalizeDiagnosticSeverity(listDiagnostic({
              resourceType,
              code: LIST_FILE_UNREADABLE,
              message: `Error reading directory: ${baseDir} (${err.message})`,
              path: baseDir,
            }), strict));
          }
        }
      }
    } else {
      if (!directories) continue;
      const dir = resourceType === "agent" ? directories.agentsDir : directories.toolsDir;
      const absoluteDir = resolve(absoluteCwd, dir);

      try {
        const stats = await fs.stat(absoluteDir);
        if (!stats.isDirectory()) {
          diagnostics.push(normalizeDiagnosticSeverity(listDiagnostic({
            resourceType,
            code: LIST_FILE_UNREADABLE,
            message: `Path is not a directory: ${dir}`,
            path: dir,
          }), strict));
          continue;
        }

        const entries = await fs.readdir(absoluteDir, { withFileTypes: true });
        for (const entry of entries) {
          const fileName = entry.name;
          const hasSupportedExtension = supportedExtensions.some(ext => fileName.endsWith(ext));
          if (!hasSupportedExtension) continue;

          const absolutePath = join(absoluteDir, fileName);
          const relativePathToReport = relative(absoluteCwd, absolutePath).split(sep).join("/");
          
          try {
            const linkStats = await fs.lstat(absolutePath);
            let targetPath = absolutePath;
            if (linkStats.isSymbolicLink()) {
              targetPath = await fs.realpath(absolutePath);
              const relativeToCwd = relative(absoluteCwd, targetPath);

              if (relativeToCwd.startsWith("..") || isAbsolute(relativeToCwd)) {
                 diagnostics.push(normalizeDiagnosticSeverity(listDiagnostic({
                  resourceType,
                  code: LIST_FILE_UNREADABLE,
                  message: `Symlink target is outside workspace root: ${fileName}`,
                  path: relativePathToReport,
                }), strict));
                continue;
              }
            }

            const realStats = await fs.stat(targetPath);
            if (!realStats.isFile()) continue;

            if (seenPaths.has(absolutePath)) continue;
            seenPaths.add(absolutePath);

            files.push({
              resourceType,
              absolutePath: targetPath,
              relativePath: relativePathToReport,
              realPath: targetPath,
              sourcePattern: "",
            });
          } catch {
            diagnostics.push(normalizeDiagnosticSeverity(listDiagnostic({
              resourceType,
              code: LIST_FILE_UNREADABLE,
              message: `Could not read file or resolve symlink: ${fileName}`,
              path: relativePathToReport,
            }), strict));
          }
        }
      } catch (err: any) {
        if (err.code === "ENOENT") {
          diagnostics.push(normalizeDiagnosticSeverity(listDiagnostic({
            resourceType,
            code: LIST_DIRECTORY_NOT_FOUND,
            message: `Directory not found: ${dir}`,
            path: dir,
          }), strict));
        } else {
          diagnostics.push(normalizeDiagnosticSeverity(listDiagnostic({
            resourceType,
            code: LIST_FILE_UNREADABLE,
            message: `Error reading directory: ${dir} (${err.message})`,
            path: dir,
          }), strict));
        }
      }
    }
  }

  files.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
  return { files, diagnostics };
}

async function checkSymlinkEscapes(dir: string, absoluteCwd: string, visitedDirs = new Set<string>()): Promise<string | undefined> {
  try {
    const realDir = await fs.realpath(dir);
    if (visitedDirs.has(realDir)) return undefined;
    visitedDirs.add(realDir);

    const entries = await fs.readdir(realDir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(realDir, entry.name);
      if (entry.isSymbolicLink()) {
        const realTarget = await fs.realpath(fullPath);
        const relativeToCwd = relative(absoluteCwd, realTarget);
        if (relativeToCwd.startsWith("..") || isAbsolute(relativeToCwd)) {
          return fullPath;
        }
        const targetStat = await fs.stat(realTarget);
        if (targetStat.isDirectory()) {
          const escapedPath = await checkSymlinkEscapes(realTarget, absoluteCwd, visitedDirs);
          if (escapedPath) return escapedPath;
        }
      } else if (entry.isDirectory()) {
        const escapedPath = await checkSymlinkEscapes(fullPath, absoluteCwd, visitedDirs);
        if (escapedPath) return escapedPath;
      }
    }
  } catch {}
  return undefined;
}
