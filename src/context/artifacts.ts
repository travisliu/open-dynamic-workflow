import { collectSecretValues, redactJsonValue } from "../security/env.js";
import { CONTEXT_LIMITS } from "./limits.js";
import { cloneJsonValue } from "./json.js";
import type { ContextFinalizationSummary, WorkflowContextRuntime, ContextOverlayPatchArtifact } from "./types.js";
import type { ArtifactStore } from "../types/artifacts.js";

import type { JsonValue } from "../types/common.js";

const defaultSecrets = collectSecretValues(process.env);

function getSafeScopeId(scopeId: string): string {
  return scopeId.replace(/[^a-zA-Z0-9-_]/g, "_");
}

function sanitizePatch(patch: ContextOverlayPatchArtifact, secrets: string[]): any {
  // Redact metadata
  const redactedMetadata = redactJsonValue(cloneJsonValue(patch.metadata), secrets) as any;

  // Redact inheritedPaths valuePreviews
  const redactedInherited = patch.inheritedPaths.map((item) => {
    const cloned = { ...item };
    if (cloned.valuePreview !== undefined) {
      cloned.valuePreview = redactJsonValue(cloneJsonValue(cloned.valuePreview), secrets) as JsonValue;
    }
    return cloned;
  });

  // Redact patchOperations valuePreviews and omit rawValue
  const redactedOperations = patch.patchOperations.map((op) => {
    const cloned = { ...op } as any;
    delete cloned.rawValue; // Omit in-memory rawValue from the persistent artifact
    if (cloned.valuePreview !== undefined) {
      cloned.valuePreview = redactJsonValue(cloneJsonValue(cloned.valuePreview), secrets) as JsonValue;
    }
    return cloned;
  });

  return {
    ...patch,
    metadata: redactedMetadata,
    inheritedPaths: redactedInherited,
    patchOperations: redactedOperations,
  };
}

export async function writeContextArtifacts(input: {
  runId: string;
  artifactStore: ArtifactStore;
  contextRuntime: WorkflowContextRuntime;
  emitEvent?: (type: string, payload: Record<string, any>) => void;
  secretValues?: Set<string> | string[];
}): Promise<ContextFinalizationSummary> {
  const { runId, artifactStore, contextRuntime, emitEvent, secretValues = defaultSecrets } = input;
  const secretsArray = secretValues instanceof Set ? Array.from(secretValues) : secretValues;

  const summary = contextRuntime.getSummary();
  const completedPatches = contextRuntime.getCompletedPatches();

  // 1. Final root snapshot serialization and size check
  let rootFrame: any;
  if (typeof (contextRuntime as any).getRootFrame === "function") {
    rootFrame = (contextRuntime as any).getRootFrame();
  }

  let rootValues: any = {};
  if (rootFrame) {
    rootValues = cloneJsonValue(rootFrame.data);
  }

  const redactedRootValues = redactJsonValue(rootValues, secretsArray) as any;
  const rootStr = JSON.stringify(redactedRootValues);
  const sizeBytes = Buffer.byteLength(rootStr, "utf8");
  const rootTruncated = sizeBytes > CONTEXT_LIMITS.maxSnapshotBytes;

  const rootFinalRelative = "context/root-final.json";
  const rootFinalArtifact: any = {
    runId,
    scopeId: runId,
    size: {
      serializedBytes: sizeBytes,
      snapshotLimitBytes: CONTEXT_LIMITS.maxSnapshotBytes,
    },
    overlayCount: summary.totalOverlays,
    conflictCount: summary.conflictCount,
    rejectedWriteCount: summary.rejectionCount,
  };

  if (rootTruncated) {
    rootFinalArtifact.truncated = true;
  } else {
    rootFinalArtifact.values = redactedRootValues;
  }

  await artifactStore.writeJson(rootFinalRelative, rootFinalArtifact);
  if (emitEvent) {
    emitEvent("context.artifact.written", {
      scopeId: runId,
      artifactPath: rootFinalRelative,
      artifactKind: "root-final",
      runId,
      truncated: rootTruncated,
    });
  }

  // 2. Write patch files
  const overlayPatchArtifactPaths: Record<string, string> = {};
  for (const patch of completedPatches) {
    const safeScopeId = getSafeScopeId(patch.scopeId);
    const relativePatchPath = `context/overlays/${safeScopeId}.patch.json`;
    const sanitized = sanitizePatch(patch, secretsArray);

    // Calculate patch size metadata
    const patchStr = JSON.stringify(sanitized);
    const patchBytes = Buffer.byteLength(patchStr, "utf8");
    sanitized.size = {
      serializedBytes: patchBytes,
      previewLimitBytes: CONTEXT_LIMITS.maxPatchPreviewBytes,
    };

    await artifactStore.writeJson(relativePatchPath, sanitized);
    overlayPatchArtifactPaths[patch.scopeId] = relativePatchPath;

    if (emitEvent) {
      emitEvent("context.artifact.written", {
        scopeId: patch.scopeId,
        artifactPath: relativePatchPath,
        artifactKind: "overlay-patch",
        runId,
        truncated: false,
      });
    }
  }

  // 3. Write summary.json
  const failedOverlays = summary.totalOverlays - summary.mergedOverlays;
  const summaryRelative = "context/summary.json";
  const finalSummary: ContextFinalizationSummary = {
    rootFinalArtifactPath: rootFinalRelative,
    summaryArtifactPath: summaryRelative,
    overlayPatchArtifactPaths,
    totalOverlays: summary.totalOverlays,
    mergedOverlays: summary.mergedOverlays,
    failedOverlays,
    conflictCount: summary.conflictCount,
    rejectionCount: summary.rejectionCount,
  };

  await artifactStore.writeJson(summaryRelative, finalSummary);
  if (emitEvent) {
    emitEvent("context.artifact.written", {
      scopeId: runId,
      artifactPath: summaryRelative,
      artifactKind: "summary",
      runId,
      truncated: false,
    });
  }

  return finalSummary;
}
