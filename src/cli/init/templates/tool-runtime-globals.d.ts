interface OdwToolExecutionContext {
  runId: string;
  toolCallId: string;
  definitionId: string;
  workflowInvocationId: string;
  parentWorkflowInvocationId?: string | undefined;
  artifactsDir: string;
  signal: AbortSignal;
  log(message: string, data?: unknown): void;
}

interface OdwToolDefinition<TInput = unknown, TOutput = unknown> {
  id: string;
  description: string;
  inputSchema: unknown;
  outputSchema?: unknown;
  defaultTimeoutMs?: number;
  cacheable?: boolean;
  metadata?: Record<string, unknown>;
  run(input: TInput, context: OdwToolExecutionContext): Promise<TOutput> | TOutput;
}

declare function defineTool<TInput = unknown, TOutput = unknown>(
  definition: OdwToolDefinition<TInput, TOutput>
): Readonly<OdwToolDefinition<TInput, TOutput>>;
