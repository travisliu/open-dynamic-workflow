import { ErrorCode } from "../errors/codes.js";
import { OpenFlowError } from "../errors/types.js";
import type { ParsedWorkflow, WorkflowMeta } from "../types/workflow.js";

export interface WorkflowDefinition {
  name: string;
  description: string;
  sourcePath: string;
  meta: WorkflowMeta;
  parsedWorkflow: ParsedWorkflow;
  inputSchema?: unknown;
}

export interface WorkflowRegistry {
  get(name: string): WorkflowDefinition | undefined;
  require(name: string): WorkflowDefinition;
  list(): readonly WorkflowDefinition[];
  names(): ReadonlySet<string>;
  inputSchemas(): ReadonlyMap<string, unknown>;
}

class DefaultWorkflowRegistry implements WorkflowRegistry {
  private readonly definitions: Map<string, WorkflowDefinition>;

  constructor(definitions: readonly WorkflowDefinition[]) {
    this.definitions = new Map();
    for (const def of definitions) {
      if (this.definitions.has(def.name)) {
        const existing = this.definitions.get(def.name)!;
        throw new OpenFlowError(
          ErrorCode.WORKFLOW_DUPLICATE_DEFINITION,
          `Duplicate workflow name '${def.name}' found in:\n  - ${existing.sourcePath}\n  - ${def.sourcePath}`
        );
      }
      this.definitions.set(def.name, def);
    }
  }

  get(name: string): WorkflowDefinition | undefined {
    return this.definitions.get(name);
  }

  require(name: string): WorkflowDefinition {
    const def = this.get(name);
    if (!def) {
      throw new OpenFlowError(
        ErrorCode.WORKFLOW_DEFINITION_NOT_FOUND,
        `Workflow definition '${name}' not found.`
      );
    }
    return def;
  }

  list(): readonly WorkflowDefinition[] {
    return Array.from(this.definitions.values());
  }

  names(): ReadonlySet<string> {
    return new Set(this.definitions.keys());
  }

  inputSchemas(): ReadonlyMap<string, unknown> {
    const schemas = new Map<string, unknown>();
    for (const [name, def] of this.definitions) {
      if (def.inputSchema) {
        schemas.set(name, def.inputSchema);
      }
    }
    return schemas;
  }
}

export function createWorkflowRegistry(definitions: readonly WorkflowDefinition[]): WorkflowRegistry {
  return new DefaultWorkflowRegistry(definitions);
}

export function createRootWorkflowRegistry(parsedWorkflow: ParsedWorkflow): WorkflowRegistry {
  const definition: WorkflowDefinition = {
    name: parsedWorkflow.meta.name,
    description: parsedWorkflow.meta.description,
    sourcePath: parsedWorkflow.sourcePath,
    meta: parsedWorkflow.meta,
    parsedWorkflow,
    inputSchema: parsedWorkflow.meta.inputSchema
  };
  return createWorkflowRegistry([definition]);
}
