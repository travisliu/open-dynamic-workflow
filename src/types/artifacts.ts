export interface AgentArtifacts {
  dir: string;
  promptPath: string;
  stdoutPath: string;
  stderrPath: string;
  rawResultPath?: string;
  normalizedResultPath?: string;
  schemaPath?: string;
  validationErrorPath?: string;
  permissionsPath?: string;
  metadataPath?: string;
}

export interface RunManifest {
  schemaVersion: "openflow.manifest.v1";
  runId: string;
  status: "running" | "succeeded" | "failed" | "cancelled";
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

export interface ToolArtifacts {
  dir: string;
  metadataPath: string;
  inputPath: string;
  outputPath?: string;
  errorPath?: string;
}

export interface RunArtifacts {
  runId: string;
  rootDir: string;
  manifestPath: string;
  workflowInputPath: string;
  resolvedConfigPath: string;
  runInputPath: string;
  callsPath: string;
  cacheIndexPath: string;
  eventsPath: string;
  reportPath: string;
  agentDir(agentId: string): string;
  toolDir(toolCallId: string): string;
  workflowInvocationDir(workflowInvocationId: string): string;
}

export interface WorkflowInvocationArtifacts {
  rootDir: string;
  inputPath: string;
  resultPath: string;
  errorPath: string;
  summaryPath: string;
}

export interface ArtifactStore {
  createRun(input: CreateRunInput): Promise<RunArtifacts>;
  writeText(relativePath: string, content: string): Promise<string>;
  appendText(relativePath: string, content: string): Promise<string>;
  writeJson(relativePath: string, value: unknown): Promise<string>;
  appendJsonl(relativePath: string, value: unknown): Promise<string>;
  writeFinalReport(value: unknown): Promise<string>;
  updateManifest(status: "succeeded" | "failed" | "cancelled", error?: any): Promise<string>;
  getRunArtifacts(): RunArtifacts;
  isRunCreated(): boolean;
}
