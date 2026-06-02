export interface AgentArtifacts {
  dir: string;
  promptPath: string;
  stdoutPath: string;
  stderrPath: string;
  rawResultPath?: string;
  normalizedResultPath?: string;
  schemaPath?: string;
  validationErrorPath?: string;
}

export interface RunManifest {
  schemaVersion: "execflow.manifest.v1";
  runId: string;
  status: "running" | "succeeded" | "failed" | "cancelled";
  createdAt: string;
  updatedAt: string;
  workflowPath: string;
  workflowHash: string;
  execflowVersion: string;
  cwd: string;
  configPath?: string;
}

export interface CreateRunInput {
  workflowPath: string;
  workflowHash: string;
  cwd: string;
  configPath?: string;
  execflowVersion: string;
}

export interface RunArtifacts {
  runId: string;
  rootDir: string;
  manifestPath: string;
  eventsPath: string;
  reportPath: string;
  agentDir(agentId: string): string;
}

export interface ArtifactStore {
  createRun(input: CreateRunInput): Promise<RunArtifacts>;
  writeText(relativePath: string, content: string | Uint8Array): Promise<string>;
  writeJson(relativePath: string, value: unknown): Promise<string>;
  appendJsonl(relativePath: string, value: unknown): Promise<void>;
  writeFinalReport(value: unknown): Promise<string>;
}
