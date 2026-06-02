import * as path from "node:path";
import * as fs from "node:fs/promises";
import type { ArtifactStore, RunArtifacts, CreateRunInput, RunManifest } from "../types/artifacts.js";
import { createInitialManifest, updateManifestStatus } from "./manifest.js";

function safeFileName(input: string): string {
  return input.replace(/[^a-zA-Z0-9._:-]/g, "_");
}

function resolveInsideRoot(rootDir: string, relativePath: string): string {
  const fullPath = path.resolve(rootDir, relativePath);
  const root = path.resolve(rootDir);

  if (!fullPath.startsWith(root + path.sep) && fullPath !== root) {
    throw new Error(`Artifact path escapes run directory: ${relativePath}`);
  }

  return fullPath;
}

export class FileSystemArtifactStore implements ArtifactStore {
  private runRootDir?: string;
  private runId?: string;
  private manifestObj?: RunManifest;
  private options: { rootDir?: string };

  constructor(options: { rootDir?: string } = {}) {
    this.options = options;
  }

  async createRun(input: CreateRunInput): Promise<RunArtifacts> {
    const outDir = input.outDir || this.options.rootDir || ".execflow/runs";
    const runRootDir = outDir.endsWith(input.runId) ? path.resolve(outDir) : path.resolve(outDir, input.runId);
    this.runRootDir = runRootDir;
    this.runId = input.runId;

    await fs.mkdir(runRootDir, { recursive: true });

    // Initial manifest
    const manifestObj = createInitialManifest({
      runId: input.runId,
      workflowPath: input.workflowPath,
      workflowHash: input.workflowHash,
      execflowVersion: input.execflowVersion,
      cwd: input.cwd,
      configPath: input.configPath
    });
    this.manifestObj = manifestObj;

    const manifestPath = path.join(runRootDir, "manifest.json");
    await fs.writeFile(manifestPath, JSON.stringify(manifestObj, null, 2), "utf8");

    // Workflow input
    const workflowInputPath = path.join(runRootDir, "workflow.input.ts");
    await fs.writeFile(workflowInputPath, input.workflowSource, "utf8");

    // Resolved config
    const resolvedConfigPath = path.join(runRootDir, "config.resolved.json");
    await fs.writeFile(resolvedConfigPath, JSON.stringify(input.resolvedConfig, null, 2), "utf8");

    // Events file
    const eventsPath = path.join(runRootDir, "events.jsonl");
    await fs.writeFile(eventsPath, "", "utf8");

    return this.getRunArtifacts();
  }

  async writeText(relativePath: string, content: string): Promise<string> {
    if (!this.runRootDir) {
      throw new Error("Run has not been created yet.");
    }
    const fullPath = resolveInsideRoot(this.runRootDir, relativePath);
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, content, "utf8");
    return fullPath;
  }

  async appendText(relativePath: string, content: string): Promise<string> {
    if (!this.runRootDir) {
      throw new Error("Run has not been created yet.");
    }
    const fullPath = resolveInsideRoot(this.runRootDir, relativePath);
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.appendFile(fullPath, content, "utf8");
    return fullPath;
  }

  async writeJson(relativePath: string, value: unknown): Promise<string> {
    return this.writeText(relativePath, JSON.stringify(value, null, 2));
  }

  async appendJsonl(relativePath: string, value: unknown): Promise<string> {
    return this.appendText(relativePath, JSON.stringify(value) + "\n");
  }

  async writeFinalReport(value: unknown): Promise<string> {
    if (!this.runRootDir) {
      throw new Error("Run has not been created yet.");
    }
    const reportPath = path.join(this.runRootDir, "report.json");
    const tmpPath = `${reportPath}.tmp`;
    await fs.writeFile(tmpPath, JSON.stringify(value, null, 2), "utf8");
    await fs.rename(tmpPath, reportPath);
    return reportPath;
  }

  async updateManifest(status: "succeeded" | "failed" | "cancelled"): Promise<string> {
    if (!this.runRootDir || !this.manifestObj) {
      throw new Error("Run has not been created yet.");
    }
    const updated = updateManifestStatus(this.manifestObj, status);
    this.manifestObj = updated;
    const manifestPath = path.join(this.runRootDir, "manifest.json");
    await fs.writeFile(manifestPath, JSON.stringify(updated, null, 2), "utf8");
    return manifestPath;
  }

  isRunCreated(): boolean {
    return !!(this.runRootDir && this.runId);
  }

  getRunArtifacts(): RunArtifacts {
    if (!this.runRootDir || !this.runId) {
      throw new Error("Run has not been created yet.");
    }
    const rootDir = this.runRootDir;
    return {
      runId: this.runId,
      rootDir,
      manifestPath: path.join(rootDir, "manifest.json"),
      workflowInputPath: path.join(rootDir, "workflow.input.ts"),
      resolvedConfigPath: path.join(rootDir, "config.resolved.json"),
      eventsPath: path.join(rootDir, "events.jsonl"),
      reportPath: path.join(rootDir, "report.json"),
      agentDir: (agentId: string) => {
        return path.join(rootDir, "agents", safeFileName(agentId));
      }
    };
  }
}
