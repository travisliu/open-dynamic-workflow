import { promises as fs } from "node:fs";
import { resolve, relative, join, sep, isAbsolute } from "node:path";
import { 
  CandidateFile, 
  DiscoveryDirectories, 
  ListDiagnostic, 
  ListResourceType,
  DiscoveryPatterns,
  PatternMatchMetrics,
  DiscoveryCollectionResult
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
import { expandIncludePattern, matchesDiscoveryPattern } from "./glob-engine.js";
import { compileResourceDiscovery, CompiledResourceDiscovery, CompiledDiscoveryPattern } from "./compile-patterns.js";

function mapResourceTypeToDiscoveryResource(rt: ListResourceType): DiscoveryResource {
  if (rt === "agent") return "sharedAgents";
  if (rt === "tool") return "tools";
  return "workflow";
}

function basenamePosix(relativePath: string): string {
  const normalized = relativePath.replace(/\\/g, "/");
  return normalized.split("/").pop() ?? normalized;
}

function shouldWarnForIncludeZeroAccepted(source: DiscoveryConfigSource): boolean {
  return source === "new" ||
    source === "legacy-dir" ||
    source === "legacy-discovery" ||
    source === "cli-override";
}

function shouldWarnForExcludeZeroMatched(source: DiscoveryConfigSource): boolean {
  return source === "new" || source === "legacy-discovery";
}

async function findSymlinkFilesUnder(
  absoluteDir: string,
  absoluteCwd: string
): Promise<string[]> {
  const symlinks: string[] = [];

  async function walkDir(currentDir: string) {
    let entries;
    try {
      entries = await fs.readdir(currentDir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const entryPath = join(currentDir, entry.name);
      if (entry.isSymbolicLink()) {
        try {
          const stats = await fs.stat(entryPath);
          if (stats.isFile()) {
            symlinks.push(entryPath);
          }
        } catch {
          // ignore broken or unreadable symlink
        }
      } else if (entry.isDirectory()) {
        await walkDir(entryPath);
      }
    }
  }

  await walkDir(absoluteDir);
  return symlinks;
}

export function isExcludedByDiscoveryPolicy(
  relativePath: string,
  exclude: CompiledDiscoveryPattern[]
): boolean {
  const normalizedRelativePath = relativePath.replace(/\\/g, "/");

  for (const excludeObj of exclude) {
    if (excludeObj.hasGlob) {
      if (matchesDiscoveryPattern(normalizedRelativePath, excludeObj.normalizedPattern)) {
        return true;
      }
    } else if (normalizedRelativePath === excludeObj.normalizedPattern) {
      return true;
    }
  }

  return false;
}

export async function collectCompiledResourceCandidateFiles(input: {
  cwd: string;
  discovery: CompiledResourceDiscovery;
  strict: boolean;
}): Promise<DiscoveryCollectionResult> {
  const { cwd, discovery, strict } = input;
  const files: CandidateFile[] = [];
  const diagnostics: ListDiagnostic[] = [];
  const configDiagnostics: ConfigDiagnostic[] = [];
  const metrics: PatternMatchMetrics[] = [];
  const absoluteCwd = resolve(cwd);

  const missingBases = new Set<string>();
  const notDirectoryBases = new Set<string>();
  const includePathsWithBaseDiagnostics = new Set<string>();

  // 1. Precompute Excludes
  const excludeTrackers: {
    excludeObj: CompiledDiscoveryPattern;
    usedCount: number;
  }[] = [];

  for (const excludeObj of discovery.exclude) {
    excludeTrackers.push({
      excludeObj,
      usedCount: 0,
    });
  }

  const matchedPaths: {
    absolutePath: string;
    relativePath: string;
    include: CompiledDiscoveryPattern;
    metric: PatternMatchMetrics;
  }[] = [];

  // 2. Expand Includes
  for (const include of discovery.include) {
    const metric: PatternMatchMetrics = {
      configPath: include.configPath,
      pattern: include.normalizedPattern,
      source: include.source,
      matchedPathCount: 0,
      acceptedCandidateCount: 0,
      rejectedByMarkerCount: 0,
      excludedCandidateCount: 0,
      rejectedBySafetyCount: 0,
    };
    metrics.push(metric);

    if (!include.hasGlob) {
      // Literal file
      const resolvedPath = resolve(absoluteCwd, include.normalizedPattern);
      const relativePathToReport = (isAbsolute(include.normalizedPattern)
        ? relative(absoluteCwd, include.normalizedPattern)
        : include.normalizedPattern).replace(/\\/g, "/");

      try {
        const stats = await fs.stat(resolvedPath);
        if (stats.isDirectory()) {
          includePathsWithBaseDiagnostics.add(include.configPath);
          if (!notDirectoryBases.has(relativePathToReport)) {
            notDirectoryBases.add(relativePathToReport);
            diagnostics.push(normalizeDiagnosticSeverity(listDiagnostic({
              resourceType: discovery.listResourceType,
              code: LIST_FILE_UNREADABLE,
              message: `Path is not a directory: ${include.rawValue}`,
              path: include.rawValue,
            }), strict));
          }
          continue;
        }

        metric.matchedPathCount++;
        matchedPaths.push({
          absolutePath: resolvedPath,
          relativePath: relativePathToReport,
          include,
          metric,
        });
      } catch (err: any) {
        includePathsWithBaseDiagnostics.add(include.configPath);
        if (err.code === "ENOENT") {
          if (!missingBases.has(relativePathToReport)) {
            missingBases.add(relativePathToReport);
            const configPath = resolve(absoluteCwd, ".open-dynamic-workflow/config.yaml");
            const defaultConfigExists = await fs.stat(configPath).then(s => s.isFile()).catch(() => false);
            if (include.source !== "default" || !defaultConfigExists) {
              diagnostics.push(normalizeDiagnosticSeverity(listDiagnostic({
                resourceType: discovery.listResourceType,
                code: LIST_DIRECTORY_NOT_FOUND,
                message: `Directory not found: ${include.rawValue}`,
                path: include.rawValue,
              }), strict));
            }
          }
        } else {
          diagnostics.push(normalizeDiagnosticSeverity(listDiagnostic({
            resourceType: discovery.listResourceType,
            code: LIST_FILE_UNREADABLE,
            message: `Could not read file: ${include.rawValue} (${err.message})`,
            path: include.rawValue,
          }), strict));
        }
      }
    } else {
      // Glob
      try {
        const stats = await fs.stat(include.absoluteBaseDir);
        if (!stats.isDirectory()) {
          includePathsWithBaseDiagnostics.add(include.configPath);
          if (!notDirectoryBases.has(include.baseDir)) {
            notDirectoryBases.add(include.baseDir);
            diagnostics.push(normalizeDiagnosticSeverity(listDiagnostic({
              resourceType: discovery.listResourceType,
              code: LIST_FILE_UNREADABLE,
              message: `Path is not a directory: ${include.baseDir}`,
              path: include.baseDir,
            }), strict));
          }
          continue;
        }

        const uniqueMatches = new Set<string>();
        const rawMatches: string[] = [];

        // 1. Add tinyglobby results
        const expanded = await expandIncludePattern({ cwd: absoluteCwd, pattern: include.normalizedPattern });
        for (const p of expanded) {
          const norm = p.replace(/\\/g, "/");
          if (!uniqueMatches.has(norm)) {
            uniqueMatches.add(norm);
            rawMatches.push(norm);
          }
        }

        // 2. Add symlink files supplement
        const symlinkFiles = await findSymlinkFilesUnder(include.absoluteBaseDir, absoluteCwd);
        for (const symlinkFile of symlinkFiles) {
          const rel = relative(absoluteCwd, symlinkFile);
          const relativePathToReport = rel.split(sep).join("/");
          if (matchesDiscoveryPattern(relativePathToReport, include.normalizedPattern)) {
            const norm = resolve(absoluteCwd, symlinkFile).replace(/\\/g, "/");
            if (!uniqueMatches.has(norm)) {
              uniqueMatches.add(norm);
              rawMatches.push(norm);
            }
          }
        }

        // 3. Process matched paths
        for (const p of rawMatches) {
          metric.matchedPathCount++;
          const rel = relative(absoluteCwd, p);
          const relativePathToReport = rel.split(sep).join("/");
          matchedPaths.push({
            absolutePath: p,
            relativePath: relativePathToReport,
            include,
            metric,
          });
        }
      } catch (err: any) {
        includePathsWithBaseDiagnostics.add(include.configPath);
        if (err.code === "ENOENT") {
          if (!missingBases.has(include.baseDir)) {
            missingBases.add(include.baseDir);
            const configPath = resolve(absoluteCwd, ".open-dynamic-workflow/config.yaml");
            const defaultConfigExists = await fs.stat(configPath).then(s => s.isFile()).catch(() => false);
            if (include.source !== "default" || !defaultConfigExists) {
              diagnostics.push(normalizeDiagnosticSeverity(listDiagnostic({
                resourceType: discovery.listResourceType,
                code: LIST_DIRECTORY_NOT_FOUND,
                message: `Directory not found: ${include.baseDir}`,
                path: include.baseDir,
              }), strict));
            }
          }
        } else {
          diagnostics.push(normalizeDiagnosticSeverity(listDiagnostic({
            resourceType: discovery.listResourceType,
            code: LIST_FILE_UNREADABLE,
            message: `Error reading directory: ${include.baseDir} (${err.message})`,
            path: include.baseDir,
          }), strict));
        }
      }
    }
  }

  // 3. Process matched paths
  const seenPaths = new Set<string>();
  const supportedExtensions = [".ts", ".js", ".mjs", ".cjs"];

  for (const { absolutePath, relativePath, include, metric } of matchedPaths) {
    // 1. Runtime extension check.
    const hasSupportedExtension = supportedExtensions.some(ext => relativePath.endsWith(ext));
    if (!hasSupportedExtension) {
      continue;
    }

    // 2. Marker policy check.
    let markerPolicyPassed = true;
    if (include.markerPolicy === "required") {
      const base = basenamePosix(relativePath);
      if (!base.includes(include.marker)) {
        markerPolicyPassed = false;
        metric.rejectedByMarkerCount++;
      }
    }
    if (!markerPolicyPassed) {
      continue;
    }

    // 3. Exclude check.
    let isExcluded = false;
    for (const tracker of excludeTrackers) {
      if (isExcludedByDiscoveryPolicy(relativePath, [tracker.excludeObj])) {
        isExcluded = true;
        tracker.usedCount++;
      }
    }
    if (isExcluded) {
      metric.excludedCandidateCount++;
      continue;
    }

    // 4. checkMatchedFileSafety().
    const safetyResult = await checkMatchedFileSafety({
      cwd: absoluteCwd,
      resource: discovery.resource,
      path: include.configPath,
      filePath: relativePath,
      source: include.source,
    });

    if (safetyResult.diagnostics && safetyResult.diagnostics.length > 0) {
      configDiagnostics.push(...safetyResult.diagnostics);
      metric.rejectedBySafetyCount++;
      continue;
    }

    // 5. fs.stat() or equivalent file check.
    const targetPath = safetyResult.realPath || absolutePath;
    let targetStats;
    try {
      targetStats = await fs.stat(targetPath);
    } catch {
      continue;
    }
    const isFile = typeof targetStats.isFile === "function"
      ? targetStats.isFile()
      : (typeof targetStats.isDirectory === "function" ? !targetStats.isDirectory() : true);
    if (!isFile) {
      continue;
    }

    // 6. Real-path dedupe.
    let realPath = targetPath;
    if (!safetyResult.realPath) {
      try {
        realPath = await fs.realpath(targetPath);
      } catch {
        realPath = resolve(targetPath);
      }
    }
    realPath = realPath.replace(/\\/g, "/");

    if (seenPaths.has(realPath)) {
      continue;
    }
    seenPaths.add(realPath);

    // 7. Candidate creation.
    files.push({
      resourceType: discovery.listResourceType,
      absolutePath: realPath,
      relativePath,
      realPath,
      sourcePattern: include.normalizedPattern,
      sourceConfigPath: include.configPath,
      source: include.source,
    });
    metric.acceptedCandidateCount++;
  }

  // Sort final files by relativePath
  files.sort((a, b) => a.relativePath.localeCompare(b.relativePath));

  // 4. Diagnostics for zero-match includes
  const totalAcceptedCount = metrics.reduce((sum, m) => sum + m.acceptedCandidateCount, 0);

  for (const metric of metrics) {
    if (metric.acceptedCandidateCount === 0 && shouldWarnForIncludeZeroAccepted(metric.source)) {
      const includeObj = discovery.include.find(inc => inc.configPath === metric.configPath);
      if (includeObj) {
        if (totalAcceptedCount > 0) {
          continue;
        }
        // check if a fatal explaining diagnostic exists
        const hasFatalExplainingDiagnostic =
          includePathsWithBaseDiagnostics.has(includeObj.configPath) ||
          diagnostics.some(d => d.severity === "error" && (d.path === includeObj.rawValue || d.path === includeObj.baseDir)) ||
          configDiagnostics.some(d => d.resource === discovery.resource && d.path === includeObj.configPath && (d.severity === "error" || d.fatalInStrictContext));

        if (!hasFatalExplainingDiagnostic) {
          let message: string;
          if (metric.matchedPathCount === 0) {
            message = `Include pattern '${includeObj.diagnosticLabel}' did not match any files.`;
          } else {
            message = `Include pattern '${includeObj.diagnosticLabel}' did not produce accepted candidate files.`;
          }

          configDiagnostics.push({
            resource: discovery.resource,
            path: includeObj.configPath,
            severity: "warning",
            code: "CONFIG_PATH_INCLUDE_MATCHED_NOTHING",
            message,
            value: includeObj.diagnosticLabel,
            fatalInStrictContext: false,
          });
        }
      }
    }
  }

  // 5. Diagnostics for zero-match excludes
  for (const tracker of excludeTrackers) {
    if (tracker.usedCount === 0 && shouldWarnForExcludeZeroMatched(tracker.excludeObj.source)) {
      configDiagnostics.push({
        resource: discovery.resource,
        path: tracker.excludeObj.configPath,
        severity: "warning",
        code: "CONFIG_PATH_EXCLUDE_MATCHED_NOTHING",
        message: `Exclude pattern '${tracker.excludeObj.diagnosticLabel}' did not match any files or was redundant.`,
        value: tracker.excludeObj.diagnosticLabel,
        fatalInStrictContext: false,
      });
    }
  }

  return {
    files,
    diagnostics,
    configDiagnostics,
    metrics,
  };
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
}): Promise<DiscoveryCollectionResult> {
  const { cwd, resourceType, include, exclude, compatibilityMode, includeSource, excludeSource, strict } = input;

  let resource: DiscoveryResource;
  let sourcePathPrefix: string;
  if (resourceType === "workflow") {
    resource = "workflow";
    sourcePathPrefix = "workflow";
  } else if (resourceType === "agent") {
    resource = "sharedAgents";
    sourcePathPrefix = "sharedAgents";
  } else {
    resource = "tools";
    sourcePathPrefix = "tools";
  }

  const resolvedIncludeSource = includeSource ?? (compatibilityMode === "default-suffix-specific" ? "default" : "new");
  const resolvedExcludeSource = excludeSource ?? resolvedIncludeSource;

  const normalized = {
    resource,
    include: include,
    exclude: exclude ?? [],
    source: resolvedIncludeSource,
    compatibilityMode,
    includeSource: resolvedIncludeSource,
    excludeSource: resolvedExcludeSource,
    rawInclude: include,
    rawExclude: exclude ?? [],
    sourcePaths: [`${sourcePathPrefix}.include`],
    diagnostics: [],
  };

  const compiled = compileResourceDiscovery({
    cwd,
    discovery: normalized,
  });

  const result = await collectCompiledResourceCandidateFiles({
    cwd,
    discovery: compiled.discovery,
    strict,
  });

  return result;
}

export async function collectCandidateFiles(input: {
  cwd: string;
  resourceTypes: ListResourceType[];
  directories?: DiscoveryDirectories;
  patterns?: DiscoveryPatterns;
  strict: boolean;
}): Promise<DiscoveryCollectionResult> {
  const { cwd, resourceTypes, directories, patterns, strict } = input;

  if (patterns) {
    const files: CandidateFile[] = [];
    const diagnostics: ListDiagnostic[] = [];
    const configDiagnostics: ConfigDiagnostic[] = [];
    const metrics: PatternMatchMetrics[] = [];

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
      metrics.push(...res.metrics);
    }

    files.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
    return { files, diagnostics, configDiagnostics, metrics };
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
                  sourceConfigPath: "legacy.directories.workflowInclude",
                  source: "legacy-dir",
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
              sourcePattern: dir,
              sourceConfigPath: resourceType === "agent" ? "sharedAgents.dir" : "tools.dir",
              source: "legacy-dir",
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
  return { files, diagnostics, configDiagnostics: [], metrics: [] };
}
