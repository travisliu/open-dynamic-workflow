import { 
  ListedResource, 
  ListDiagnostic, 
  ListResourceType 
} from "./types.js";
import { 
  listDiagnostic, 
  WORKFLOW_DUPLICATE_NAME, 
  AGENT_DUPLICATE_ID, 
  TOOL_DUPLICATE_ID,
  normalizeDiagnosticSeverity
} from "./diagnostics.js";

export function detectDuplicateResources(input: {
  resources: ListedResource[];
  strict: boolean;
}): { resources: ListedResource[]; diagnostics: ListDiagnostic[] } {
  const { resources, strict } = input;
  const diagnostics: ListDiagnostic[] = [];
  
  const seenByType: Record<ListResourceType, Map<string, string>> = {
    workflow: new Map(),
    agent: new Map(),
    tool: new Map(),
  };

  const codeByType: Record<ListResourceType, string> = {
    workflow: WORKFLOW_DUPLICATE_NAME,
    agent: AGENT_DUPLICATE_ID,
    tool: TOOL_DUPLICATE_ID,
  };

  const updatedResources = resources.map(resource => {
    const key = resource.type === "workflow" ? resource.name : (resource as any).id;
    const firstPath = seenByType[resource.type].get(key);

    if (firstPath) {
      const diag = listDiagnostic({
        resourceType: resource.type,
        code: codeByType[resource.type],
        message: `Duplicate ${resource.type} '${key}' found at ${resource.path}. First seen at ${firstPath}.`,
        path: resource.path,
        details: { firstPath }
      });
      const normalized = normalizeDiagnosticSeverity(diag, strict);
      diagnostics.push(normalized);

      return {
        ...resource,
        warnings: [...(resource.warnings ?? []), normalized]
      } as ListedResource;
    } else {
      seenByType[resource.type].set(key, resource.path);
      return resource;
    }
  });

  return { resources: updatedResources, diagnostics };
}
