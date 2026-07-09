import type { ContextMergeSummary, ContextMergeStrategy } from "./types.js";
import type { ContextScopeFrame } from "./overlay.js";
import {
  frameGet,
  frameSet,
  frameDelete,
  frameMerge,
  frameAppend,
  incrementPathVersions,
} from "./overlay.js";
import { isAncestorPath } from "./path.js";
import type { JsonObject, JsonValue } from "../types/common.js";

export function deepEqual(a: any, b: any): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return false;
  if (typeof a === "object") {
    if (Array.isArray(a)) {
      if (!Array.isArray(b) || a.length !== b.length) return false;
      return a.every((val, idx) => deepEqual(val, b[idx]));
    }
    const keysA = Object.keys(a);
    const keysB = Object.keys(b);
    if (keysA.length !== keysB.length) return false;
    return keysA.every(
      (k) => Object.prototype.hasOwnProperty.call(b, k) && deepEqual(a[k], b[k])
    );
  }
  return false;
}

function getMutatedPaths(frame: ContextScopeFrame): Set<string> {
  const paths = new Set<string>();
  if (frame.operationLog && frame.operationLog.length > 0) {
    for (const op of frame.operationLog) {
      paths.add(op.path);
    }
  } else {
    for (const tomb of frame.tombstones) {
      paths.add(tomb);
    }
    function collect(obj: any, current: string) {
      if (obj && typeof obj === "object" && !Array.isArray(obj)) {
        for (const [k, v] of Object.entries(obj)) {
          const next = current ? `${current}.${k}` : k;
          paths.add(next);
          collect(v, next);
        }
      }
    }
    collect(frame.data, "");
  }
  return paths;
}

export function isRulePathMutated(frame: ContextScopeFrame, rulePath: string): boolean {
  const mutated = getMutatedPaths(frame);
  for (const path of mutated) {
    if (path === rulePath || isAncestorPath(rulePath, path)) {
      return true;
    }
  }
  return false;
}

export function getModifiedKeys(frame: ContextScopeFrame, R: string): Map<string, unknown> {
  const keys = new Map<string, unknown>();
  const Rsegs = R.split(".");
  
  if (frame.operationLog && frame.operationLog.length > 0) {
    for (const op of frame.operationLog) {
      if (op.path === R) {
        const val = frameGet(frame, Rsegs, R);
        if (val && typeof val === "object" && !Array.isArray(val)) {
          for (const [k, v] of Object.entries(val)) {
            keys.set(k, v);
          }
        }
      } else if (isAncestorPath(R, op.path)) {
        const relative = op.path.slice(R.length + 1);
        const firstKey = relative.split(".")[0]!;
        const keyPath = `${R}.${firstKey}`;
        const val = frameGet(frame, keyPath.split("."), keyPath);
        keys.set(firstKey, val);
      }
    }
  } else {
    const val = frameGet(frame, Rsegs, R);
    if (val && typeof val === "object" && !Array.isArray(val)) {
      for (const [k, v] of Object.entries(val)) {
        keys.set(k, v);
      }
    }
  }
  return keys;
}

export function detectGroupConflicts(
  parent: ContextScopeFrame,
  frames: ContextScopeFrame[]
): string[] {
  const conflictPaths = new Set<string>();

  // 1. Check rejectOnConflict against parent current versions
  for (const frame of frames) {
    for (const R of Object.keys(frame.mergeRules)) {
      if (frame.mergeRules[R] === "rejectOnConflict" && isRulePathMutated(frame, R)) {
        const parentVer = parent.pathVersions[R] ?? 0;
        const capturedVer = frame.capturedVersions[R] ?? 0;
        if (parentVer !== capturedVer) {
          conflictPaths.add(R);
        }
      }
    }
  }

  // 2. Check sibling conflicts
  for (let i = 0; i < frames.length; i++) {
    const frameA = frames[i]!;
    for (let j = i + 1; j < frames.length; j++) {
      const frameB = frames[j]!;

      for (const RA of Object.keys(frameA.mergeRules)) {
        if (!isRulePathMutated(frameA, RA)) continue;

        for (const RB of Object.keys(frameB.mergeRules)) {
          if (!isRulePathMutated(frameB, RB)) continue;

          // If the paths overlap (either same, or ancestor/descendant)
          if (RA === RB || isAncestorPath(RA, RB) || isAncestorPath(RB, RA)) {
            const strategyA = frameA.mergeRules[RA]!;
            const strategyB = frameB.mergeRules[RB]!;

            if (
              strategyA === "replace" ||
              strategyA === "rejectOnConflict" ||
              strategyB === "replace" ||
              strategyB === "rejectOnConflict"
            ) {
              conflictPaths.add(RA === RB ? RA : isAncestorPath(RA, RB) ? RB : RA);
            } else if (strategyA === "merge" && strategyB === "merge") {
              const keysA = getModifiedKeys(frameA, RA);
              const keysB = getModifiedKeys(frameB, RB);
              for (const [k, valA] of keysA.entries()) {
                if (keysB.has(k)) {
                  const valB = keysB.get(k);
                  if (!deepEqual(valA, valB)) {
                    conflictPaths.add(`${RA}.${k}`);
                  }
                }
              }
            } else {
              if (strategyA !== strategyB) {
                conflictPaths.add(RA === RB ? RA : isAncestorPath(RA, RB) ? RB : RA);
              }
            }
          }
        }
      }
    }
  }

  return Array.from(conflictPaths).sort();
}

function isPathInherited(frame: ContextScopeFrame, path: string): boolean {
  return (frame.inheritedPaths || []).some(
    (inh) => inh.found && (inh.path === path || isAncestorPath(inh.path, path))
  );
}

function arrayStartsWith(arr: any[], prefix: any[]): boolean {
  if (arr.length < prefix.length) return false;
  for (let i = 0; i < prefix.length; i++) {
    if (!deepEqual(arr[i], prefix[i])) return false;
  }
  return true;
}

export function mergeSingleFrame(
  parent: ContextScopeFrame,
  frame: ContextScopeFrame
): ContextMergeSummary {
  const mergedPaths: string[] = [];
  const rejectedPaths: string[] = [];
  const conflictPaths: string[] = [];
  const details: NonNullable<ContextMergeSummary["details"]> = {};

  // 1. Identify uncovered writes
  const uncovered = new Set<string>();
  const mutatedPaths = getMutatedPaths(frame);
  for (const path of mutatedPaths) {
    let covered = false;
    for (const rulePath of Object.keys(frame.mergeRules)) {
      if (rulePath === path || isAncestorPath(rulePath, path)) {
        covered = true;
        break;
      }
    }
    if (!covered) {
      uncovered.add(path);
    }
  }

  for (const path of uncovered) {
    rejectedPaths.push(path);
    details[path] = {
      strategy: "replace",
      status: "rejected",
      reason: "merge_rule_required",
    };
  }

  // 2. Prevalidate mutated rule paths (dry-run pass to ensure all-or-nothing behavior)
  const rulePaths = Object.keys(frame.mergeRules);
  for (const R of rulePaths) {
    if (!isRulePathMutated(frame, R)) continue;

    const strategy = frame.mergeRules[R]!;
    const Rsegs = R.split(".");

    if (strategy === "rejectOnConflict") {
      const parentVer = parent.pathVersions[R] ?? 0;
      const capturedVer = frame.capturedVersions[R] ?? 0;
      if (parentVer !== capturedVer) {
        conflictPaths.push(R);
        details[R] = {
          strategy,
          status: "conflict",
          reason: "parent_modified",
        };
      }
    } else if (strategy === "append") {
      const parentVal = frameGet(parent, Rsegs, R);
      if (parentVal !== undefined && parentVal !== null && !Array.isArray(parentVal)) {
        conflictPaths.push(R);
        details[R] = {
          strategy,
          status: "conflict",
          reason: "target_not_array",
        };
      } else {
        const ops = (frame.operationLog || []).filter(
          (op) => op.path === R || isAncestorPath(R, op.path)
        );
        let hasDescendantMutation = false;
        for (const op of ops) {
          if (isAncestorPath(R, op.path)) {
            hasDescendantMutation = true;
            break;
          }
        }
        if (hasDescendantMutation) {
          conflictPaths.push(R);
          details[R] = {
            strategy,
            status: "conflict",
            reason: "descendant_mutation_ambiguous",
          };
        } else {
          for (const op of ops) {
            if (op.op !== "append" && op.op !== "set") {
              conflictPaths.push(R);
              details[R] = {
                strategy,
                status: "conflict",
                reason: `unsupported_array_operation_${op.op}`,
              };
              break;
            }
          }
        }
      }
    } else if (strategy === "merge") {
      const parentVal = frameGet(parent, Rsegs, R);
      if (
        parentVal !== undefined &&
        parentVal !== null &&
        (typeof parentVal !== "object" || Array.isArray(parentVal))
      ) {
        conflictPaths.push(R);
        details[R] = {
          strategy,
          status: "conflict",
          reason: "target_not_object",
        };
      } else {
        const childVal = frameGet(frame, Rsegs, R);
        if (childVal !== undefined) {
          if (typeof childVal !== "object" || Array.isArray(childVal) || childVal === null) {
            conflictPaths.push(R);
            details[R] = {
              strategy,
              status: "conflict",
              reason: "source_not_object",
            };
          }
        }
      }
    }
  }

  // If there are any conflicts, abort mutations (guaranteeing all-or-nothing behavior)
  if (conflictPaths.length > 0) {
    return {
      mergedPaths,
      rejectedPaths,
      conflictPaths,
      details,
    };
  }

  // 3. Process mutations (only if no conflicts are found)
  for (const R of rulePaths) {
    if (!isRulePathMutated(frame, R)) continue;

    const strategy = frame.mergeRules[R]!;
    const Rsegs = R.split(".");
    const childVal = frameGet(frame, Rsegs, R) as JsonValue;

    try {
      if (strategy === "replace" || strategy === "rejectOnConflict") {
        if (childVal === undefined) {
          frameDelete(parent, Rsegs, R);
        } else {
          frameSet(parent, Rsegs, childVal, R);
        }
        mergedPaths.push(R);
        details[R] = { strategy, status: "merged" };
      } else if (strategy === "append") {
        const parentVal = frameGet(parent, Rsegs, R);
        const parentArr = Array.isArray(parentVal) ? parentVal : [];
        const hasInheritedArray = Array.isArray(parentVal) && isPathInherited(frame, R);

        const ops = (frame.operationLog || []).filter(
          (op) => op.path === R || isAncestorPath(R, op.path)
        );

        if (ops.length > 0) {
          for (const op of ops) {
            const opRawVal = (op as any).rawValue;
            if (op.op === "append") {
              frameAppend(parent, Rsegs, opRawVal, R);
            } else if (op.op === "set") {
              if (Array.isArray(opRawVal)) {
                const itemsToAppend = hasInheritedArray && arrayStartsWith(opRawVal, parentArr)
                  ? opRawVal.slice(parentArr.length)
                  : opRawVal;
                for (const item of itemsToAppend) {
                  frameAppend(parent, Rsegs, item, R);
                }
              } else {
                frameAppend(parent, Rsegs, opRawVal, R);
              }
            }
          }
        } else {
          if (childVal !== undefined) {
            if (Array.isArray(childVal)) {
              const itemsToAppend = hasInheritedArray && arrayStartsWith(childVal, parentArr)
                ? childVal.slice(parentArr.length)
                : childVal;
              for (const item of itemsToAppend) {
                frameAppend(parent, Rsegs, item, R);
              }
            } else {
              frameAppend(parent, Rsegs, childVal, R);
            }
          }
        }
        mergedPaths.push(R);
        details[R] = { strategy, status: "merged" };
      } else if (strategy === "merge") {
        if (childVal !== undefined) {
          frameMerge(parent, Rsegs, childVal as JsonObject, R);
        }
        mergedPaths.push(R);
        details[R] = { strategy, status: "merged" };
      }
    } catch (err: any) {
      conflictPaths.push(R);
      details[R] = {
        strategy,
        status: "conflict",
        reason: err.message || String(err),
      };
    }
  }

  return {
    mergedPaths,
    rejectedPaths,
    conflictPaths,
    details,
  };
}
