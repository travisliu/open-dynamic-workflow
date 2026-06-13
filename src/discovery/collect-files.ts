import { promises as fs } from "node:fs";
import { resolve, relative, join, sep, isAbsolute } from "node:path";
import { 
  CandidateFile, 
  DiscoveryDirectories, 
  ListDiagnostic, 
  ListResourceType 
} from "./types.js";
import { 
  listDiagnostic, 
  normalizeDiagnosticSeverity,
  LIST_DIRECTORY_NOT_FOUND, 
  LIST_FILE_UNREADABLE 
} from "./diagnostics.js";
import { walk, matchGlob, getGlobBaseDir } from "./file-patterns.js";

export async function collectCandidateFiles(input: {
  cwd: string;
  resourceTypes: ListResourceType[];
  directories: DiscoveryDirectories;
  strict: boolean;
}): Promise<{ files: CandidateFile[]; diagnostics: ListDiagnostic[] }> {
  const { cwd, resourceTypes, directories, strict } = input;
  const files: CandidateFile[] = [];
  const diagnostics: ListDiagnostic[] = [];

  const absoluteCwd = resolve(cwd);
  const supportedExtensions = [".ts", ".js", ".mjs", ".cjs"];
  const seenPaths = new Set<string>();

  for (const resourceType of resourceTypes) {
    if (resourceType === "workflow") {
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

          // Walk the base directory and find matches
          for await (const p of walk(absoluteBaseDir)) {
            const hasSupportedExtension = supportedExtensions.some(ext => p.endsWith(ext));
            if (!hasSupportedExtension) continue;

            const relPath = relative(absoluteCwd, p);
            if (matchGlob(relPath, globPattern)) {
              const relativePathToReport = relPath.split(sep).join("/");
              
              try {
                // Use lstat first to check if it is a symlink
                const linkStats = await fs.lstat(p);
                
                let targetPath = p;
                if (linkStats.isSymbolicLink()) {
                  targetPath = await fs.realpath(p);
                  const relativeToCwd = relative(absoluteCwd, targetPath);

                  // Security check: do not follow symlinks outside cwd
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
                });
              } catch (err) {
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
      // agents and tools still use single directory scanning
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
            // Use lstat first to check if it is a symlink
            const linkStats = await fs.lstat(absolutePath);
            
            let targetPath = absolutePath;
            if (linkStats.isSymbolicLink()) {
              targetPath = await fs.realpath(absolutePath);
              const relativeToCwd = relative(absoluteCwd, targetPath);

              // Security check: do not follow symlinks outside cwd
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
            });
          } catch (err) {
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

  // Sort candidate files by normalized relative path.
  files.sort((a, b) => a.relativePath.localeCompare(b.relativePath));

  return { files, diagnostics };
}
