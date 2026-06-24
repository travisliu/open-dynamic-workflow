import type { SerializedError } from "../types/errors.js";
import type { ToolCallInput, ToolSettledResult } from "../types/tool.js";

export type LoopFailureMode = "throw" | "settled";
export type LoopStatus = "succeeded" | "failed" | "cancelled" | "timed_out" | "max_rounds";
export type LoopRoundStatus = "completed" | "failed" | "cancelled" | "timed_out";

export interface LoopOptions {
  failureMode?: LoopFailureMode;
  maxRounds: number;
  timeoutMs?: number;
}

export interface LoopInput<TState> {
  label: string;
  initialState: TState;
  options: LoopOptions;
  run: LoopRunFunction<TState>;
}

export type LoopRunFunction<TState> = (
  state: Readonly<TState>,
  ctx: LoopContext
) => Promise<LoopRunResult<TState>> | LoopRunResult<TState>;

export interface LoopRunResult<TState> {
  done: boolean;
  nextState: TState;
}

export interface LoopContext {
  loopId: string;
  label: string;
  roundIndex: number;  // zero-based
  roundNumber: number; // one-based
  signal: AbortSignal;
  agent: (input: any) => Promise<any>;
  workflow: (input: any) => Promise<any>;
  tool<TOutput = unknown>(
    input: ToolCallInput & { failureMode?: "throw" }
  ): Promise<TOutput>;
  tool<TOutput = unknown>(
    input: ToolCallInput & { failureMode: "settled" }
  ): Promise<ToolSettledResult<TOutput>>;
  tool<TOutput = unknown>(
    input: ToolCallInput
  ): Promise<TOutput | ToolSettledResult<TOutput>>;
  log: (message: string, data?: any) => void;
  agentId: (suffix?: string) => string;
  toolId: (suffix?: string) => string;
  sleep: (ms: number) => Promise<void>;
}

export interface LoopSettledSuccess<TState> {
  ok: true;
  status: "succeeded";
  label: string;
  loopId: string;
  roundsCompleted: number;
  finalState: TState;
  artifacts: {
    dir: string;
  };
}

export interface LoopSettledFailure<TState> {
  ok: false;
  status: "failed" | "cancelled" | "timed_out" | "max_rounds";
  label: string;
  loopId: string;
  roundsCompleted: number;
  finalState?: TState;
  error?: SerializedError;
  artifacts: {
    dir: string;
  };
}

export type LoopSettledResult<TState> = LoopSettledSuccess<TState> | LoopSettledFailure<TState>;

// Internal runtime types
export interface NormalizedLoopInput<TState> {
  label: string;
  initialState: TState;
  options: {
    failureMode: LoopFailureMode;
    maxRounds: number;
    timeoutMs?: number;
  };
  run: LoopRunFunction<TState>;
}

export interface LoopRoundRecord<TState> {
  index: number; // zero-based round index
  roundNumber: number; // one-based round number
  status: "completed" | "failed" | "cancelled" | "timed_out";
  inputState: TState;
  nextState?: TState;
  durationMs: number;
  error?: SerializedError;
  nestedCalls: {
    agents: string[];
    workflows: string[];
    tools: string[];
  };
}

export interface LoopExecutionRecord<TState> {
  schemaVersion: string;
  loopId: string;
  label: string;
  status: "succeeded" | "failed" | "cancelled" | "timed_out" | "max_rounds";
  roundsCompleted: number;
  maxRounds: number;
  initialState: TState;
  finalState?: TState;
  rounds: LoopRoundRecord<TState>[];
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  artifactPath: string;
  error?: SerializedError;
}

export interface LoopSummary {
  loopId: string;
  label: string;
  status: "succeeded" | "failed" | "cancelled" | "timed_out" | "max_rounds";
  roundsCompleted: number;
  maxRounds: number;
  durationMs: number;
  artifactPath: string;
  error?: SerializedError;
}

export interface LoopReplayRecord {
  loopId: string;
  label: string;
  optionsFingerprint: string;
  initialStateHash: string;
  maxRounds: number;
  maxRoundsCeiling: number;
  rounds: Array<{
    index: number;
    roundNumber: number;
    stateBeforeHash: string;
    stateAfterHash?: string;
    nestedCallSequence: string[];
  }>;
}
