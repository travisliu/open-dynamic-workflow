import { isAbsolute, resolve } from "node:path";

export function resolveUserPath(input: string, cwd = process.cwd()): string {
  return isAbsolute(input) ? input : resolve(cwd, input);
}

export function resolveProjectPath(input: string, cwd = process.cwd()): string {
  return resolve(cwd, input);
}
