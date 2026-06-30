import { 
  DiscoveryService, 
  ListDiscoveryOptions, 
  DiscoveryRawResult, 
  DiscoveryRawSummary, 
  ListResourceType, 
  ResourceExtractor, 
  ListedResource,
  ListDiagnostic
} from "./types.js";
import type { ConfigDiagnostic } from "../config/types.js";
import { collectCandidateFiles } from "./collect-files.js";
import { extractWorkflow } from "./extract-workflow.js";
import { extractAgent } from "./extract-agent.js";
import { extractTool } from "./extract-tool.js";
import { detectDuplicateResources } from "./duplicate-detector.js";
import { 
  listDiagnostic, 
  LIST_INTERNAL_ERROR,
  normalizeDiagnosticSeverity,
} from "./diagnostics.js";

export function createDiscoveryService(input?: {
  extractors?: Partial<Record<ListResourceType, ResourceExtractor>>;
}): DiscoveryService {
  const extractors: Record<ListResourceType, ResourceExtractor> = {
    workflow: { resourceType: "workflow", extract: extractWorkflow },
    agent: { resourceType: "agent", extract: extractAgent },
    tool: { resourceType: "tool", extract: extractTool },
    ...(input?.extractors ?? {})
  };

  return {
    async discover(options: ListDiscoveryOptions): Promise<DiscoveryRawResult> {
      const { resourceTypes, strict } = options;
      const allDiagnostics: ListDiagnostic[] = [];
      const configDiagnostics: ConfigDiagnostic[] = [];
      const resources: ListedResource[] = [];

      try {
        // 1. Collect candidate files
        const { files, diagnostics: collectDiagnostics, configDiagnostics: colConfigDiagnostics } = await collectCandidateFiles(options);
        allDiagnostics.push(...collectDiagnostics.map(d => normalizeDiagnosticSeverity(d, strict)));
        if (colConfigDiagnostics) {
          configDiagnostics.push(...colConfigDiagnostics);
        }

        // 2. Extract resources
        const discoveredCount = files.length;
        
        for (const file of files) {
          const extractor = extractors[file.resourceType];
          if (!extractor) continue;

          try {
            const result = await extractor.extract(file);
            if (result.ok) {
              resources.push(result.resource);
              if (result.diagnostics) {
                allDiagnostics.push(...result.diagnostics.map(d => normalizeDiagnosticSeverity(d, strict)));
              }
            } else {
              allDiagnostics.push(...result.diagnostics.map(d => normalizeDiagnosticSeverity(d, strict)));
            }
          } catch (err: any) {
            allDiagnostics.push(normalizeDiagnosticSeverity(listDiagnostic({
              resourceType: file.resourceType,
              code: LIST_INTERNAL_ERROR,
              message: `Unexpected error extracting ${file.resourceType} at ${file.relativePath}: ${err.message}`,
              path: file.relativePath,
            }), strict));
          }
        }

        // 3. Detect duplicates
        const { resources: dedupedResources, diagnostics: dedupeDiagnostics } = detectDuplicateResources({
          resources,
          strict
        });
        allDiagnostics.push(...dedupeDiagnostics);
        
        // 4. Stable sorting
        const typeOrder: Record<ListResourceType, number> = {
          workflow: 0,
          agent: 1,
          tool: 2,
        };

        dedupedResources.sort((a, b) => {
          if (a.type !== b.type) {
            return typeOrder[a.type as ListResourceType] - typeOrder[b.type as ListResourceType];
          }
          const aKey = a.type === "workflow" ? a.name : (a as any).id;
          const bKey = b.type === "workflow" ? b.name : (b as any).id;
          if (aKey !== bKey) {
            return aKey.localeCompare(bKey);
          }
          return a.path.localeCompare(b.path);
        });

        // 5. Summary construction
        const warnings = allDiagnostics.filter(d => d.severity === "warning");
        const errors = allDiagnostics.filter(d => d.severity === "error");

        const configWarningCount = configDiagnostics.filter((d) => d.severity === "warning").length;
        const configErrorCount = configDiagnostics.filter((d) => d.severity === "error").length;

        const countsByType: Partial<Record<ListResourceType, number>> = {};
        for (const r of dedupedResources) {
          countsByType[r.type as ListResourceType] = (countsByType[r.type as ListResourceType] ?? 0) + 1;
        }

        const summary: DiscoveryRawSummary = {
          discoveredCount,
          validCount: dedupedResources.length,
          warningCount: warnings.length,
          errorCount: errors.length,
          configWarningCount,
          configErrorCount,
          countsByType,
        };

        return {
          schemaVersion: "open-dynamic-workflow.list.v1",
          resourceTypes,
          resources: dedupedResources,
          warnings,
          errors,
          summary,
          configDiagnostics,
        };

      } catch (err: any) {
        const diag = listDiagnostic({
          resourceType: resourceTypes[0] ?? "workflow",
          code: LIST_INTERNAL_ERROR,
          message: `Internal discovery error: ${err.message}`,
          path: ".",
        });
        const normalized = normalizeDiagnosticSeverity(diag, true);
        
        return {
          schemaVersion: "open-dynamic-workflow.list.v1",
          resourceTypes,
          resources: [],
          warnings: [],
          errors: [normalized],
          summary: {
            discoveredCount: 0,
            validCount: 0,
            warningCount: 0,
            errorCount: 1,
            configWarningCount: 0,
            configErrorCount: 0,
            countsByType: {},
          },
          configDiagnostics: [],
        };
      }
    }
  };
}
