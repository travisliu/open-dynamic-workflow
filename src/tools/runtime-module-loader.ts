import { pathToFileURL } from "node:url";
import type { BrandedToolDefinition } from "../types/tool.js";
import type { StaticToolContract } from "./definition-contract.js";
import { isDefinedTool } from "./define-tool.js";
import { ErrorCode } from "../errors/codes.js";
import { OpenDynamicWorkflowError } from "../errors/types.js";
import type { ToolRuntimeApi } from "./runtime-api.js";
import type { ToolRuntimeGlobalLock } from "./runtime-global-lock.js";
import { withInjectedToolRuntimeGlobals } from "./runtime-globals.js";

export interface MirroredToolCandidate {
  sourcePath: string;
  relativePath: string;
  modulePath: string;
  staticContract?: StaticToolContract;
}

export interface RuntimeModuleLoaderInput {
  candidates: readonly MirroredToolCandidate[];
  runtimeApi: ToolRuntimeApi;
  lock: ToolRuntimeGlobalLock;
}

export interface LoadedToolDefinition {
  definition: BrandedToolDefinition;
  sourcePath: string;
}

function isSupportedJsonValue(val: any): boolean {
  if (val === null) return true;
  const t = typeof val;
  if (t === "string" || t === "number" || t === "boolean") {
    return true;
  }
  if (Array.isArray(val)) {
    return true;
  }
  if (t === "object") {
    const proto = Object.getPrototypeOf(val);
    return proto === Object.prototype || proto === null;
  }
  return false;
}

function jsonDeepEqual(a: any, b: any): boolean {
  if (!isSupportedJsonValue(a) || !isSupportedJsonValue(b)) {
    return false;
  }

  if (Object.is(a, b)) {
    return true;
  }

  if (a === null || b === null || typeof a !== "object" || typeof b !== "object") {
    return false;
  }

  const aIsArray = Array.isArray(a);
  const bIsArray = Array.isArray(b);
  if (aIsArray !== bIsArray) {
    return false;
  }

  if (aIsArray) {
    if (a.length !== b.length) {
      return false;
    }
    for (let i = 0; i < a.length; i++) {
      if (!jsonDeepEqual(a[i], b[i])) {
        return false;
      }
    }
    return true;
  }

  const keysA = Object.keys(a);
  const keysB = Object.keys(b);

  if (keysA.length !== keysB.length) {
    return false;
  }

  keysA.sort();
  keysB.sort();

  for (let i = 0; i < keysA.length; i++) {
    const keyA = keysA[i];
    const keyB = keysB[i];
    if (keyA === undefined || keyB === undefined || keyA !== keyB) {
      return false;
    }
    if (!jsonDeepEqual(a[keyA], b[keyA])) {
      return false;
    }
  }

  return true;
}

function assertRuntimeDefinitionMatchesStaticContract(
  definition: any,
  contract: StaticToolContract,
  relativePath: string
): void {
  const compareField = (fieldName: keyof StaticToolContract, isJson: boolean) => {
    const contractValue = contract[fieldName];
    const definitionValue = (definition as any)[fieldName];

    const contractHas = contractValue !== undefined;
    const definitionHas = definitionValue !== undefined;

    if (contractHas !== definitionHas) {
      throw new OpenDynamicWorkflowError(
        ErrorCode.TOOL_INVALID_DEFINITION,
        `Tool definition field '${fieldName}' changed after static validation against statically extracted contract in '${relativePath}'.`
      );
    }

    if (contractHas) {
      const match = isJson
        ? jsonDeepEqual(contractValue, definitionValue)
        : contractValue === definitionValue;

      if (!match) {
        throw new OpenDynamicWorkflowError(
          ErrorCode.TOOL_INVALID_DEFINITION,
          `Tool definition field '${fieldName}' changed after static validation against statically extracted contract in '${relativePath}'.`
        );
      }
    }
  };

  compareField("id", false);
  compareField("description", false);
  compareField("inputSchema", true);
  compareField("outputSchema", true);
  compareField("defaultTimeoutMs", false);
  compareField("metadata", true);
}

export async function loadMirroredToolModules(
  input: RuntimeModuleLoaderInput
): Promise<LoadedToolDefinition[]> {
  return input.lock.runExclusive(() =>
    withInjectedToolRuntimeGlobals(input.runtimeApi, async () => {
      const results: LoadedToolDefinition[] = [];
      for (const candidate of input.candidates) {
        let module: any;
        try {
          const url = pathToFileURL(candidate.modulePath).href;
          module = await import(url);
        } catch (err: any) {
          throw new OpenDynamicWorkflowError(
            ErrorCode.TOOL_INVALID_DEFINITION,
            `Failed to load tool definition from '${candidate.sourcePath}': ${err.message}`,
            { cause: err }
          );
        }

        const definition = module.default;
        if (!isDefinedTool(definition)) {
          throw new OpenDynamicWorkflowError(
            ErrorCode.TOOL_INVALID_DEFINITION,
            `Tool file '${candidate.sourcePath}' does not have a valid default export created with defineTool().`
          );
        }

        if (candidate.staticContract) {
          assertRuntimeDefinitionMatchesStaticContract(
            definition,
            candidate.staticContract,
            candidate.relativePath
          );
        }

        results.push({
          definition,
          sourcePath: candidate.sourcePath,
        });
      }
      return results;
    })
  );
}
