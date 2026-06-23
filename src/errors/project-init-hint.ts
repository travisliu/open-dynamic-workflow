import * as fs from "node:fs";
import * as path from "node:path";
import type { ListDiagnostic } from "../discovery/types.js";

export interface InitializationHint {
  code: "PROJECT_INIT_MISSING";
  message: string;
  command: string;
  docsContext?: string;
}

export interface ProjectInitHintContext {
  defaultConfigExists: boolean;
  hasExplicitConfig: boolean;
  explicitResolvesToDefault: boolean;
  commandName: string;
}

export function detectProjectInitHintContext(input: {
  cwd: string;
  configPath?: string;
  invokedBinaryName?: string;
}): ProjectInitHintContext {
  const resolvedCwd = path.resolve(input.cwd);
  const defaultPath = path.resolve(resolvedCwd, ".open-dynamic-workflow/config.yaml");
  const defaultConfigExists = fs.existsSync(defaultPath);
  const hasExplicitConfig = input.configPath !== undefined;

  let explicitResolvesToDefault = false;
  if (hasExplicitConfig && input.configPath !== undefined) {
    const explicitResolved = path.resolve(resolvedCwd, input.configPath);
    explicitResolvesToDefault = explicitResolved === defaultPath;
  } else if (!hasExplicitConfig) {
    explicitResolvesToDefault = true;
  }

  const binaryName = input.invokedBinaryName || "odw";

  return {
    defaultConfigExists,
    hasExplicitConfig,
    explicitResolvesToDefault,
    commandName: binaryName,
  };
}

export function buildProjectInitHint(context: ProjectInitHintContext): InitializationHint | undefined {
  if (context.defaultConfigExists) {
    return undefined;
  }
  if (context.hasExplicitConfig && !context.explicitResolvesToDefault) {
    return undefined;
  }

  return {
    code: "PROJECT_INIT_MISSING",
    message: `This project may not be initialized yet. Run \`${context.commandName} init\` to create .open-dynamic-workflow/config.yaml and default project directories.`,
    command: `${context.commandName} init`,
    docsContext: "Project initialization creates the default config, shared agent directory, tool directory, and starter workflow layout.",
  };
}

export function isHintEligibleDiagnostic(diagnostic: ListDiagnostic): boolean {
  if (diagnostic.code === "LIST_DIRECTORY_NOT_FOUND") {
    return true;
  }
  if (diagnostic.code === "AGENT_DEFINITION_MISSING") {
    return true;
  }
  return false;
}

export function isHintEligibleError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }
  const code = (error as any).code;
  if (!code) {
    return false;
  }
  if (
    code === "SHARED_AGENT_NOT_FOUND" ||
    code === "WORKFLOW_DEFINITION_NOT_FOUND" ||
    code === "WORKFLOW_DISCOVERY_FAILED"
  ) {
    return true;
  }
  if (code === "WORKFLOW_TARGET_NOT_FOUND") {
    const msg = (error as any).message;
    return msg !== "Workflow target is required.";
  }
  if (code === "WORKFLOW_VALIDATION_ERROR") {
    const msg = (error as any).message || "";
    return msg.includes("was not found in the configured registry") || msg.includes("was not found in the registry");
  }
  return false;
}

export function attachHintToDiagnostic(
  diagnostic: ListDiagnostic,
  context: ProjectInitHintContext
): ListDiagnostic {
  if (diagnostic.hint) {
    return diagnostic;
  }
  const hint = buildProjectInitHint(context);
  if (hint && isHintEligibleDiagnostic(diagnostic)) {
    diagnostic.hint = hint;
  }
  return diagnostic;
}

export function attachHintToError(
  error: unknown,
  context: ProjectInitHintContext
): unknown {
  if (!error || typeof error !== "object") {
    return error;
  }
  const errAny = error as any;
  if (errAny.hint) {
    return error;
  }
  const hint = buildProjectInitHint(context);
  if (hint && isHintEligibleError(error)) {
    errAny.hint = hint;
  }
  return error;
}
