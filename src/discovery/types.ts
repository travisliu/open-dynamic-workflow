import type { InitializationHint } from "../errors/project-init-hint.js";
import type { DiscoveryCompatibilityMode, DiscoveryConfigSource, ConfigDiagnostic } from "../config/types.js";
import type { CompiledDiscoveryPattern } from "./compile-patterns.js";


export type ListResourceType = "workflow" | "agent" | "tool";
export type ListCliResourceType = "all" | ListResourceType;
export type ListReportMode = "pretty" | "json" | "jsonl";

export interface ResourceDiscoveryPatterns {
  include: string[];
  exclude: string[];
  compatibilityMode: DiscoveryCompatibilityMode;
  includeSource?: DiscoveryConfigSource | undefined;
  excludeSource?: DiscoveryConfigSource | undefined;
}

export interface DiscoveryPatterns {
  workflow: ResourceDiscoveryPatterns;
  agent: ResourceDiscoveryPatterns;
  tool: ResourceDiscoveryPatterns;
}

export interface DiscoveryDirectories {
  workflowInclude: string[];
  agentsDir: string;
  toolsDir: string;
}

export interface CandidateFile {
  resourceType: ListResourceType;
  absolutePath: string;
  relativePath: string;
  realPath: string;
  sourcePattern: string;
  sourceConfigPath: string;
  source: DiscoveryConfigSource;
}

export interface PrecollectedResourceLoadInput {
  candidateFiles: CandidateFile[];
  discoveryPolicy: {
    exclude: CompiledDiscoveryPattern[];
  };
}


export interface PatternMatchMetrics {
  configPath: string;
  pattern: string;
  source: DiscoveryConfigSource;
  matchedPathCount: number;
  acceptedCandidateCount: number;
  rejectedByMarkerCount: number;
  excludedCandidateCount: number;
  rejectedBySafetyCount: number;
}

export interface DiscoveryCollectionResult {
  files: CandidateFile[];
  diagnostics: ListDiagnostic[];
  configDiagnostics: ConfigDiagnostic[];
  metrics: PatternMatchMetrics[];
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
  configWarningCount: number;
  configErrorCount: number;
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
  configDiagnostics: ConfigDiagnostic[];
}

export interface ListDiscoveryOptions {
  cwd: string;
  resourceTypes: ListResourceType[];
  directories?: DiscoveryDirectories;
  patterns?: DiscoveryPatterns;
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

export interface DiscoveryRawSummary {
  discoveredCount: number;
  validCount: number;
  warningCount: number;
  errorCount: number;
  configWarningCount: number;
  configErrorCount: number;
  countsByType: Partial<Record<ListResourceType, number>>;
}

export interface DiscoveryRawResult {
  schemaVersion: "open-dynamic-workflow.list.v1";
  resourceTypes: ListResourceType[];
  resources: ListedResource[];
  warnings: ListDiagnostic[];
  errors: ListDiagnostic[];
  summary: DiscoveryRawSummary;
  configDiagnostics: ConfigDiagnostic[];
}

export interface DiscoveryService {
  discover(options: ListDiscoveryOptions): Promise<DiscoveryRawResult>;
}

