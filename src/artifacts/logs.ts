import * as path from "node:path";
import * as fs from "node:fs/promises";

export interface AgentArtifactPaths {
  dir: string;
  promptPath: string;
  stdoutPath: string;
  stderrPath: string;
  rawResultPath: string;
  normalizedResultPath: string;
  schemaPath: string;
  validationErrorPath: string;
}

function safeFileName(input: string): string {
  return input.replace(/[^a-zA-Z0-9._:-]/g, "_");
}

export function getAgentArtifactPaths(rootDir: string, agentId: string): AgentArtifactPaths {
  const safeId = safeFileName(agentId);
  const agentDir = path.join(rootDir, "agents", safeId);
  return {
    dir: agentDir,
    promptPath: path.join(agentDir, "prompt.txt"),
    stdoutPath: path.join(agentDir, "stdout.log"),
    stderrPath: path.join(agentDir, "stderr.log"),
    rawResultPath: path.join(agentDir, "raw-result.json"),
    normalizedResultPath: path.join(agentDir, "normalized-result.json"),
    schemaPath: path.join(agentDir, "schema.json"),
    validationErrorPath: path.join(agentDir, "validation-error.json")
  };
}

export async function ensureAgentArtifactDir(paths: AgentArtifactPaths): Promise<void> {
  await fs.mkdir(paths.dir, { recursive: true });
}
