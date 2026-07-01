import { ErrorCode } from "../errors/codes.js";
import { OpenDynamicWorkflowError } from "../errors/types.js";

export const DEFAULT_MAX_PROCESS_ARG_ENV_BYTES = 256 * 1024;

export interface ProcessSizeGuardInput {
  command: string;
  args: string[];
  env?: Record<string, string | undefined> | undefined;
}

export interface ProcessSizeEstimate {
  commandBytes: number;
  argvBytes: number;
  envBytes: number;
  totalBytes: number;
}

export function estimateProcessSize(input: ProcessSizeGuardInput): ProcessSizeEstimate {
  const commandBytes = byteLength(input.command) + 1;
  const argvBytes = commandBytes + input.args.reduce((total, arg) => total + byteLength(arg) + 1, 0);
  const envBytes = Object.entries(input.env ?? {}).reduce(
    (total, [key, value]) => {
      if (value === undefined) {
        return total;
      }
      return total + byteLength(key) + 1 + byteLength(value) + 1;
    },
    0
  );
  const totalBytes = argvBytes + envBytes;
  return {
    commandBytes,
    argvBytes,
    envBytes,
    totalBytes
  };
}

export function assertProcessSizeWithinLimits(
  input: ProcessSizeGuardInput,
  maxProcessArgEnvBytes = DEFAULT_MAX_PROCESS_ARG_ENV_BYTES
): void {
  const size = estimateProcessSize(input);
  if (size.totalBytes > maxProcessArgEnvBytes) {
    throw new OpenDynamicWorkflowError(
      ErrorCode.CLI_USAGE_ERROR,
      `Process argv/env payload is too large before spawn. argvBytes=${size.argvBytes} envBytes=${size.envBytes} totalBytes=${size.totalBytes} maxProcessArgEnvBytes=${maxProcessArgEnvBytes}. Reduce prompt size or move payload to stdin.`
    );
  }
}

function byteLength(value: string): number {
  return Buffer.byteLength(value, "utf8");
}
