export type SupportedInitProvider =
  | "mock"
  | "codex"
  | "gemini"
  | "copilot"
  | "opencode"
  | "antigravity"
  | "pi";

export type InitReportMode = "pretty" | "json";
export type InitTargetKind = "file" | "directory";
export type InitWriteAction = "create" | "skip" | "overwrite" | "reuse-directory";

export interface InitCliOptions {
  cwd?: string;
  yes?: boolean;
  provider?: string;
  force?: boolean;
  strict?: boolean;
  runSmokeTest?: boolean;
  report?: InitReportMode;
  workflowsDir?: string;
  agentsDir?: string;
  toolsDir?: string;
}

export interface ResolvedInitOptions {
  cwd: string;
  interactive: boolean;
  requestedProvider?: SupportedInitProvider;
  force: boolean;
  strict: boolean;
  runSmokeTest: boolean;
  smokeReport: InitReportMode;
  workflowsDir: string;
  agentsDir: string;
  toolsDir: string;
}

export interface ProviderCandidate {
  name: SupportedInitProvider;
  command: string | null;
  builtIn: boolean;
  detected: boolean;
  recommendedRank: number;
}

export interface ProviderSelection {
  defaultProvider: SupportedInitProvider;
  requestedProvider?: SupportedInitProvider;
  selectedReason:
    | "explicit-detected"
    | "explicit-undetected-interactive-continue"
    | "explicit-undetected-noninteractive-fallback"
    | "auto-detected"
    | "mock-fallback"
    | "interactive-choice";
  warning?: string;
}

export interface InitTarget {
  kind: InitTargetKind;
  path: string;              // normalized absolute path
  displayPath: string;       // path relative to cwd for output
  content?: string;          // only for file targets
  overwrite: boolean;
  requiredForStrict: boolean;
}

export interface InitPlannedTarget extends InitTarget {
  exists: boolean;
  existingKind?: "file" | "directory" | "other" | undefined;
  action: InitWriteAction;
  conflictReason?: string | undefined;
}

export interface InitPlan {
  cwd: string;
  providerSelection: ProviderSelection;
  targets: InitPlannedTarget[];
  strictConflicts: InitPlannedTarget[];
  pathConflicts: InitPlannedTarget[];
  nextSteps: string[];
}

export interface InitWriteResult {
  created: string[];
  skipped: string[];
  overwritten: string[];
  reusedDirectories: string[];
}

export interface InitSmokeTestResult {
  requested: boolean;
  validateStatus?: "succeeded" | "failed";
  runStatus?: "succeeded" | "failed";
  reportMode?: InitReportMode;
  error?: unknown;
}

export interface InitResult {
  plan: InitPlan;
  writeResult: InitWriteResult;
  smokeTest: InitSmokeTestResult;
}
