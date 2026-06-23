import type { InitializationHint } from "../errors/project-init-hint.js";

export type ListResourceType = "workflow" | "agent" | "tool";
export type ListCliResourceType = "all" | ListResourceType;
export type ListReportMode = "pretty" | "json" | "jsonl";

export interface DiscoveryDirectories {
  workflowInclude: string[];
  agentsDir: string;
  toolsDir: string;
}

export interface CandidateFile {
  resourceType: ListResourceType;
  absolutePath: string;
  relativePath: string;
}

export interface ListDiagnostic {
  severity: "warning" | "error";
  resourceType: ListResourceType;
  path: string;
  code: string;
  message: string;
  details?: Record<string, unknown>;
  hint?: InitializationHint | undefined;
}

export interface ListedWorkflow {
  type: "workflow";
  name: string;
  description: string;
  phases?: string[];
  version?: string;
  tags?: string[];
  inputSchema?: unknown;
  path: string;
  valid: true;
  warnings?: ListDiagnostic[];
}

export interface ListedAgent {
  type: "agent";
  id: string;
  description: string;
  metadata?: Record<string, unknown>;
  inputSchema?: unknown;
  requiredInputs?: string[];
  path: string;
  valid: true;
  warnings?: ListDiagnostic[];
}

export interface ListedTool {
  type: "tool";
  id: string;
  description: string;
  inputSchema?: unknown;
  outputSchema?: unknown;
  requiredInputs?: string[];
  defaultTimeoutMs?: number;
  path: string;
  valid: true;
  warnings?: ListDiagnostic[];
}

export type ListedResource = ListedWorkflow | ListedAgent | ListedTool;

export interface ListSummary {
  discoveredCount: number;
  validCount: number;
  warningCount: number;
  errorCount: number;
  countsByType: Partial<Record<ListResourceType, number>>;
}

export interface ListResult {
  schemaVersion: "open-dynamic-workflow.list.v1";
  status: "succeeded" | "partially_succeeded" | "failed";
  resourceTypes: ListResourceType[];
  resources: ListedResource[];
  warnings: ListDiagnostic[];
  errors: ListDiagnostic[];
  summary: ListSummary;
}

export interface ListDiscoveryOptions {
  cwd: string;
  resourceTypes: ListResourceType[];
  directories: DiscoveryDirectories;
  verbose: boolean;
  strict: boolean;
}

export type ResourceExtractionResult =
  | { ok: true; resource: ListedResource; diagnostics?: ListDiagnostic[] }
  | { ok: false; diagnostics: ListDiagnostic[] };

export interface ResourceExtractor {
  resourceType: ListResourceType;
  extract(file: CandidateFile): Promise<ResourceExtractionResult>;
}

export interface DiscoveryService {
  discover(options: ListDiscoveryOptions): Promise<ListResult>;
}
