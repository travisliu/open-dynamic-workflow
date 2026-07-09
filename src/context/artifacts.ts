import { collectSecretValues, redactJsonValue } from "../security/env.js";
import { CONTEXT_LIMITS } from "./limits.js";
import { cloneJsonValue } from "./json.js";
import type { ContextFinalizationSummary, WorkflowContextRuntime } from "./types.js";
import type { ArtifactStore } from "../types/artifacts.js";

const defaultSecrets = collectSecretValues(process.env);

export async function writeContextArtifacts(input: {
  runId: string;
  artifactStore: ArtifactStore;
  contextRuntime: WorkflowContextRuntime;
  emitEvent?: (type: string, payload: Record<string, any>) => void;
  secretValues?: Set<string> | string[];
}): Promise<ContextFinalizationSummary> {
  const { runId, artifactStore, contextRuntime, emitEvent, secretValues = defaultSecrets } = input;
  const secretsArray = secretValues instanceof Set ? Array.from(secretValues) : secretValues;

  // 1. Final root snapshot serialization and size check
  const rootValues = contextRuntime.getRootSnapshotData();

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

  // 2. Write summary.json
  const summaryRelative = "context/summary.json";
  const finalSummary: ContextFinalizationSummary = {
    rootFinalArtifactPath: rootFinalRelative,
    summaryArtifactPath: summaryRelative,
    scopeId: runId,
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

