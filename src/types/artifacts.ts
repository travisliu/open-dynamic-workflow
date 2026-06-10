export interface AgentArtifacts {
  dir: string;
  promptPath: string;
  stdoutPath: string;
  stderrPath: string;
  lastMessagePath?: string;
  rawResultPath?: string;
  normalizedResultPath?: string;
  schemaPath?: string;
  validationErrorPath?: string;
}

export interface RunManifest {
  schemaVersion: "openflow.manifest.v1";
  runId: string;
  status: "running" | "succeeded" | "failed" | "cancelled" | "pending";
  createdAt: string;
  updatedAt: string;
  workflowPath: string;
  workflowHash: string;
  openflowVersion: string;
  cwd: string;
  configPath?: string | undefined;
  error?: any;
}

export interface CreateRunInput {
  runId: string;
  outDir: string;
  workflowPath: string;
  workflowSource: string;
  workflowHash: string;
  resolvedConfig: unknown;
  openflowVersion: string;
  cwd: string;
  configPath?: string | undefined;
}

export interface RunArtifacts {
  runId: string;
  rootDir: string;
  manifestPath: string;
  workflowInputPath: string;
  resolvedConfigPath: string;
  eventsPath: string;
  callsPath: string;
  cacheIndexPath: string;
  reportPath: string;
  agentDir(agentId: string): string;
}

export interface ArtifactStore {
  createRun(input: CreateRunInput): Promise<RunArtifacts>;
  writeText(relativePath: string, content: string): Promise<string>;
  appendText(relativePath: string, content: string): Promise<string>;
  writeJson(relativePath: string, value: unknown): Promise<string>;
  appendJsonl(relativePath: string, value: unknown): Promise<string>;
  writeFinalReport(value: unknown): Promise<string>;
  updateManifest(status: "succeeded" | "failed" | "cancelled" | "pending", error?: any): Promise<string>;
  getRunArtifacts(): RunArtifacts;
  isRunCreated(): boolean;
}
