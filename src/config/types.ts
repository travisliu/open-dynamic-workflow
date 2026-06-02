export type ProviderName = "codex" | "gemini" | "mock" | string;
export type ReporterMode = "pretty" | "json" | "jsonl";

export interface ProviderConfig {
  command: string;
  args: string[];
  defaultModel: string | null;
  timeoutMs?: number;
  env?: Record<string, string>;
  responses?: Record<string, unknown>; // Used by mock provider.
}

export interface SecurityConfig {
  passEnv: string[];
  redactEnv: string[];
  allowShell: false;
  allowWorkflowImports: false;
}

export interface ExecflowConfig {
  defaultProvider: ProviderName;
  concurrency: number;
  timeoutMs: number;
  providers: Record<string, ProviderConfig>;
  security: SecurityConfig;
  reporting: {
    mode: ReporterMode;
    verbose: boolean;
  };
  failFast?: boolean;
}

export interface ResolvedExecflowConfig extends ExecflowConfig {
  configPath?: string;
  cwd: string;
  outDir: string;
}
