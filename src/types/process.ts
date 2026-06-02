export interface ProcessRunInput {
  command: string;
  args: string[];
  cwd: string;
  stdin?: string;
  env?: Record<string, string>;
  timeoutMs: number;
  signal?: AbortSignal;
  onStdout?: (chunk: string) => void | Promise<void>;
  onStderr?: (chunk: string) => void | Promise<void>;
}

export interface ProcessRunResult {
  exitCode: number | null;
  signal: string | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  timedOut: boolean;
  cancelled: boolean;
}
