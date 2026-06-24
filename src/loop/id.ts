import { InvalidDslCallError } from "../workflow/errors.js";

const ID_NAME_PATTERN = /^[A-Za-z0-9_.:-]+$/;
const TOOL_ID_SUFFIX_PATTERN = /^[A-Za-z0-9_-]+$/;

/**
 * Creates a stable loop identifier.
 */
export function createLoopId(label: string): string {
  if (!label || typeof label !== "string" || label.trim() === "") {
    throw new InvalidDslCallError("Loop label is required to generate loop ID.");
  }
  return normalizeLoopLabel(label);
}

/**
 * Creates a stable round identifier.
 */
export function createRoundId(loopId: string, roundNumber: number): string {
  if (!loopId || typeof loopId !== "string") {
    throw new InvalidDslCallError("createRoundId: loopId is required and must be a string.");
  }
  if (typeof roundNumber !== "number" || roundNumber < 1 || isNaN(roundNumber) || !Number.isInteger(roundNumber)) {
    throw new InvalidDslCallError("createRoundId: roundNumber must be a positive integer.");
  }
  const paddedIndex = roundNumber.toString().padStart(4, "0");
  return `${loopId}-round-${paddedIndex}`;
}

/**
 * Input for createLoopAgentId.
 */
export interface CreateLoopAgentIdInput {
  label: string;
  roundNumber: number;
  suffix?: string;
}

export interface CreateLoopToolIdInput {
  label: string;
  roundNumber: number;
  suffix?: string;
}

/**
 * Normalizes a loop label for use in IDs.
 */
export function normalizeLoopLabel(label: string): string {
  if (!label || typeof label !== "string") {
    return "";
  }
  return label
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9_.:-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Creates a stable agent identifier for use inside a loop round.
 */
export function createLoopAgentId(input: CreateLoopAgentIdInput): string {
  const normalizedLabel = normalizeLoopLabel(input.label);
  const roundPart = `round-${input.roundNumber}`;

  if (input.suffix) {
    const trimmedSuffix = input.suffix.trim();
    if (trimmedSuffix === "") {
      throw new InvalidDslCallError("createLoopAgentId: suffix cannot be empty or whitespace-only.");
    }
    if (trimmedSuffix === "." || trimmedSuffix === "..") {
      throw new InvalidDslCallError("createLoopAgentId: suffix cannot be '.' or '..'.");
    }
    if (trimmedSuffix.includes("/") || trimmedSuffix.includes("\\")) {
      throw new InvalidDslCallError("createLoopAgentId: suffix cannot contain path separators.");
    }
    if (trimmedSuffix.includes("..")) {
      throw new InvalidDslCallError("createLoopAgentId: suffix cannot contain path traversal segments.");
    }
    if (!ID_NAME_PATTERN.test(trimmedSuffix)) {
      throw new InvalidDslCallError(
        `createLoopAgentId: suffix '${input.suffix}' contains invalid characters. Only alphanumeric, underscores, dots, colons, and hyphens are allowed.`
      );
    }
    return `${normalizedLabel}:${roundPart}:${trimmedSuffix}`;
  }

  return `${normalizedLabel}:${roundPart}`;
}

export function createLoopToolId(input: CreateLoopToolIdInput): string {
  const normalizedLabel = Array.from(normalizeLoopLabel(input.label), char => {
    return /^[a-z0-9-]$/.test(char)
      ? char
      : `_${char.codePointAt(0)!.toString(16)}_`;
  }).join("");
  if (!normalizedLabel) {
    throw new InvalidDslCallError("createLoopToolId: label must produce a non-empty ID.");
  }
  if (!Number.isInteger(input.roundNumber) || input.roundNumber < 1) {
    throw new InvalidDslCallError("createLoopToolId: roundNumber must be a positive integer.");
  }

  const suffix = input.suffix === undefined ? "tool" : input.suffix.trim();
  if (!suffix) {
    throw new InvalidDslCallError("createLoopToolId: suffix cannot be empty or whitespace-only.");
  }
  if (
    suffix === "." ||
    suffix === ".." ||
    suffix.includes("/") ||
    suffix.includes("\\") ||
    suffix.includes("..")
  ) {
    throw new InvalidDslCallError("createLoopToolId: suffix cannot contain path traversal segments.");
  }
  if (!TOOL_ID_SUFFIX_PATTERN.test(suffix)) {
    throw new InvalidDslCallError(
      `createLoopToolId: suffix '${input.suffix}' contains invalid characters. Only alphanumeric, underscores, and hyphens are allowed.`
    );
  }

  return `${normalizedLabel}-round-${input.roundNumber}-tool-${suffix}`;
}
