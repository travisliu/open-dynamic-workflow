import type { ProfileSource, ResolvedWorkflowProfile } from "./config.js";

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
  schemaVersion: "open-dynamic-workflow.manifest.v1";
  runId: string;
  status: "running" | "succeeded" | "failed" | "cancelled";
  createdAt: string;
  updatedAt: string;
  workflowPath: string;
  workflowHash: string;
  workflow?: {
    name: string;
    file: string;
    requestedTarget: string;
    targetKind: "workflow-name" | "workflow-file";
  } | undefined;
  openDynamicWorkflowVersion: string;
  cwd: string;
  configPath?: string | undefined;
  error?: any;
}

export interface CreateRunInput {
  runId: string;
  /** Absolute parent directory that contains individual run directories. */
  runsRoot: string;
  workflowPath: string;
  workflowSource: string;
  workflowHash: string;
  workflow?: {
    name: string;
    file: string;
    requestedTarget: string;
    targetKind: "workflow-name" | "workflow-file";
  } | undefined;
  resolvedConfig: unknown;
  openDynamicWorkflowVersion: string;
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
  /** Absolute parent directory that contains this run directory. */
  runsRoot: string;
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

export interface RecordedRunProfileInput {
  selected: string;
  source: ProfileSource;
  profilesPath?: string | undefined;
  resolved: ResolvedWorkflowProfile;
  hash: string;
  inheritanceChain?: string[] | undefined;
  resumedFromRecordedProfile?: true | undefined;
}

export interface RunInputArtifactV1 {
  schemaVersion: "open-dynamic-workflow.run-input.v1";
  runId: string;
  workflowFile: string;
  requestedTarget?: string | undefined;
  targetKind?: "workflow-name" | "workflow-file" | undefined;
  workflowName?: string | undefined;
  cwd?: string | undefined;
  outDir?: string | undefined;
  configPath?: string | undefined;
  args?: Record<string, any> | undefined;
  rawOptions?: Record<string, any> | undefined;
  profile?: RecordedRunProfileInput | undefined;
  [key: string]: any;
}
