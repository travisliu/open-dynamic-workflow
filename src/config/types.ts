export type ProviderName = "codex" | "gemini" | "mock" | string;
export type ReporterMode = "pretty" | "json" | "jsonl";

export interface ProviderModelArgConfig {
  flag: string;
}

export interface ProviderConfig {
  command: string;
  args?: string[];
  defaultModel: string | null;
  modelArg?: ProviderModelArgConfig | false;
  timeoutMs?: number;
  env?: Record<string, string>;
  responses?: Record<string, unknown>; // Used by mock provider.
  promptMode?: "stdin" | "arg";
  sandbox?: "read-only" | "workspace-write" | "danger-full-access";
  approval?: "untrusted" | "on-request" | "never";
  ephemeral?: boolean;
  profile?: string;
  profileV2?: string;
  config?: string[];
  ignoreUserConfig?: boolean;
  ignoreRules?: boolean;
  skipGitRepoCheck?: boolean;
  addDir?: string[];
}

export interface SecurityConfig {
  passEnv: string[];
  redactEnv: string[];
  allowShell: false;
  allowWorkflowImports: false;
}

export interface OpenFlowConfig {
  defaultProvider: ProviderName;
  concurrency: number;
  timeoutMs: number;
  defaultModel?: string | null;
  providers: Record<string, ProviderConfig>;
  security: SecurityConfig;
  reporting: {
    mode: ReporterMode;
    verbose: boolean;
  };
  failFast?: boolean;
}

export interface ResolvedOpenFlowConfig extends OpenFlowConfig {
  configPath?: string;
  cwd: string;
  outDir: string;
}
