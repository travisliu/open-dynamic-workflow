import { CandidateFile, ResourceExtractionResult } from "./types.js";
import { validateStaticToolContract } from "../tools/definition-contract.js";

export async function extractTool(file: CandidateFile): Promise<ResourceExtractionResult> {
  const result = await validateStaticToolContract(file);
  if (result.ok) {
    return { ok: true, resource: result.resource };
  } else {
    return { ok: false, diagnostics: result.diagnostics };
  }
}
