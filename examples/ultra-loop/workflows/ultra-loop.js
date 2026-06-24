export const meta = {
  name: "ultra-loop",
  description: "Run or resume an Ultra Loop durable evidence-gated agent workflow.",
  phases: ["bootstrap", "status", "steering", "goal-loop", "quality-gate", "finalize"],
  version: "1.0.0",
  tags: ["ultra-loop", "evidence", "checkpoint"]
};

const finalSummarySchema = {
  type: "object",
  properties: {
    summary: { type: "string" },
    workflowStatus: {
      type: "string",
      enum: ["complete", "in_progress", "failed", "blocked", "needs_user_decision"]
    },
    nextAction: {
      type: ["string", "null"]
    },
    risks: {
      type: "array",
      items: { type: "string" }
    }
  },
  required: ["summary", "workflowStatus", "nextAction", "risks"]
};

const steeringProposalSchema = {
  type: "object",
  properties: {
    proposal: {
      type: "object",
      properties: {
        kind: { type: "string" },
        goalId: { type: "string" },
        criterionId: { type: "string" },
        scenario: { type: "string" },
        expectedEvidence: { type: "string" },
        evidence: { type: "string" },
        rationale: { type: "string" }
      },
      required: ["kind", "evidence", "rationale"]
    }
  },
  required: ["proposal"]
};

const qualityReviewSchema = {
  type: "object",
  properties: {
    recommendation: {
      type: "string",
      enum: ["approve", "reject", "needs_user_decision"]
    },
    summary: { type: "string" },
    blockers: {
      type: "array",
      items: { type: "string" }
    },
    evidenceRefs: {
      type: "array",
      items: { type: "string" }
    }
  },
  required: ["recommendation", "summary", "blockers", "evidenceRefs"]
};

const brief = typeof args.brief === "string" ? args.brief : "";
const runIdArg = typeof args.runId === "string" ? args.runId : "";
const storageRoot = typeof args.storageRoot === "string" ? args.storageRoot : ".ultra-loop";
const mode = typeof args.mode === "string" ? args.mode : "aggregate";
const maxWorkflowIterations =
  typeof args.maxWorkflowIterations === "number" ? args.maxWorkflowIterations : 50;
const maxGoalAttempts = typeof args.maxGoalAttempts === "number" ? args.maxGoalAttempts : 3;
const artifactValidation =
  args.artifactValidation !== false && args.artifactValidation !== "false";
const qualityGateRequired =
  args.qualityGateRequired !== false && args.qualityGateRequired !== "false";
const steeringDirective = args.steeringDirective || null;
const resumePolicy = typeof args.resumePolicy === "string" ? args.resumePolicy : "";

if (brief.length === 0 && runIdArg.length === 0) {
  throw new Error("ultra-loop requires either args.brief for a new run or args.runId to resume.");
}

if (brief.length > 0 && runIdArg.length > 0 && resumePolicy.length === 0) {
  throw new Error("Pass args.resumePolicy when both args.brief and args.runId are provided.");
}

if (mode !== "aggregate" && mode !== "per-goal") {
  throw new Error("args.mode must be either 'aggregate' or 'per-goal'.");
}

if (maxWorkflowIterations < 1 || maxGoalAttempts < 1) {
  throw new Error("args.maxWorkflowIterations and args.maxGoalAttempts must be positive.");
}

phase("bootstrap");

const run = runIdArg.length > 0
  ? {
      ok: true,
      runId: runIdArg,
      resumed: true
    }
  : await tool({
      id: "ultra-loop-create-run",
      definition: "ultra-loop.create-run",
      args: {
        brief,
        runId: typeof args.explicitRunId === "string" ? args.explicitRunId : "",
        storageRoot,
        mode,
        seedCriteria: true
      }
    });

log("Ultra Loop run selected", {
  runId: run.runId,
  mode,
  resumed: run.resumed === true
});

phase("status");

let status = await tool({
  id: "ultra-loop-status-initial",
  definition: "ultra-loop.status",
  args: {
    runId: run.runId,
    storageRoot
  }
});

let steeringResult = null;

if (steeringDirective !== null) {
  phase("steering");

  const parsedSteering =
    typeof steeringDirective === "string"
      ? await agent({
          id: `parse-steering-${run.runId}`,
          prompt: `Convert this Ultra Loop steering request into one structured proposal.

The proposal must be explicit, auditable, and include evidence and rationale. It must not mutate state directly.

${JSON.stringify({
  runId: run.runId,
  currentStatus: status,
  steeringDirective
}, null, 2)}

Return exactly one JSON object matching the schema.`,
          schema: steeringProposalSchema,
          structuredOutput: {
            transport: "auto"
          }
        })
      : {
          json: {
            proposal: steeringDirective
          }
        };

  steeringResult = await tool({
    id: "ultra-loop-steer",
    definition: "ultra-loop.steer",
    args: {
      runId: run.runId,
      storageRoot,
      idempotencyKey: args.steeringIdempotencyKey || "ultra-loop-steering-request",
      proposal: parsedSteering.json?.proposal || steeringDirective
    },
    failureMode: "settled"
  });

  status = await tool({
    id: "ultra-loop-status-after-steering",
    definition: "ultra-loop.status",
    args: {
      runId: run.runId,
      storageRoot
    }
  });
}

phase("goal-loop");

let loopResult = null;

if (status.aggregateCompletion?.status !== "complete" && status.status !== "blocked") {
  loopResult = await loop({
    label: "ultra-loop-goals",
    initialState: {
      runId: run.runId,
      roundsCompleted: 0,
      lastRound: null
    },
    options: {
      maxRounds: maxWorkflowIterations,
      failureMode: "settled",
      timeoutMs: args.goalLoopTimeoutMs || 3_600_000
    },
    run: async (state, ctx) => {
      const round = await ctx.workflow({
        name: "ultra-loop-round",
        args: {
          runId: state.runId,
          storageRoot,
          artifactValidation,
          maxGoalAttempts,
          roundNumber: state.roundsCompleted + 1
        },
        failureMode: "throw",
        timeoutMs: args.goalRoundTimeoutMs || 1_800_000
      });

      const nextState = {
        runId: state.runId,
        roundsCompleted: state.roundsCompleted + 1,
        lastRound: round
      };

      ctx.log("Ultra Loop round completed", {
        roundNumber: nextState.roundsCompleted,
        goalId: round.goalId,
        reason: round.reason,
        recordedEvidenceCount: round.recordedEvidenceCount,
        nextAction: round.nextAction
      });

      return {
        done: round.done === true,
        nextState
      };
    }
  });
}

status = await tool({
  id: "ultra-loop-status-before-quality-gate",
  definition: "ultra-loop.status",
  args: {
    runId: run.runId,
    storageRoot
  }
});

let qualityGate = null;
let aggregateCheckpoint = null;

if (
  qualityGateRequired &&
  status.status !== "blocked" &&
  status.status !== "needs_user_decision" &&
  status.aggregateCompletion?.status !== "complete"
) {
  phase("quality-gate");

  const qualityReviews = await parallel({
    codeReview: () => agent({
      id: `quality-code-review-${run.runId}`,
      prompt: `Review Ultra Loop durable state for code correctness and regression risk.

Do not approve unless durable status and evidence indicate all completion-blocking work is resolved.

${JSON.stringify(status, null, 2)}

Return exactly one JSON object matching the schema.`,
      schema: qualityReviewSchema,
      structuredOutput: {
        transport: "auto"
      }
    }),
    manualQa: () => agent({
      id: `quality-manual-qa-${run.runId}`,
      prompt: `Review manual QA readiness for this Ultra Loop run.

Focus on observable evidence, missing scenarios, and unresolved blockers.

${JSON.stringify(status, null, 2)}

Return exactly one JSON object matching the schema.`,
      schema: qualityReviewSchema,
      structuredOutput: {
        transport: "auto"
      }
    }),
    criteriaCoverage: () => agent({
      id: `quality-criteria-coverage-${run.runId}`,
      prompt: `Review criterion coverage for this Ultra Loop run.

Every essential criterion must have non-empty, observable evidence before approval.

${JSON.stringify(status, null, 2)}

Return exactly one JSON object matching the schema.`,
      schema: qualityReviewSchema,
      structuredOutput: {
        transport: "auto"
      }
    })
  });

  qualityGate = await tool({
    id: "ultra-loop-quality-gate",
    definition: "ultra-loop.quality-gate",
    args: {
      runId: run.runId,
      reports: {
        codeReview: qualityReviews.codeReview.json || qualityReviews.codeReview,
        manualQa: qualityReviews.manualQa.json || qualityReviews.manualQa,
        criteriaCoverage: qualityReviews.criteriaCoverage.json || qualityReviews.criteriaCoverage
      },
      storageRoot
    },
    failureMode: "settled"
  });

  aggregateCheckpoint = await tool({
    id: "ultra-loop-aggregate-checkpoint",
    definition: "ultra-loop.checkpoint",
    args: {
      runId: run.runId,
      storageRoot,
      scope: "aggregate",
      status: qualityGate.ok === true && qualityGate.value?.approved === true ? "complete" : "blocked",
      evidence: "Aggregate checkpoint requested after final quality gate review.",
      qualityGateRef: qualityGate.value?.qualityGatePath || null
    },
    failureMode: "settled"
  });
}

phase("finalize");

const finalStatus = await tool({
  id: "ultra-loop-status-final",
  definition: "ultra-loop.status",
  args: {
    runId: run.runId,
    storageRoot
  }
});

const ledger = await tool({
  id: "ultra-loop-ledger-final",
  definition: "ultra-loop.ledger",
  args: {
    runId: run.runId,
    storageRoot,
    tail: 100
  },
  failureMode: "settled"
});

const summarizer = await agent({
  id: `final-summary-${run.runId}`,
  prompt: `Create a concise final Ultra Loop workflow summary.

Completion can only be reported when durable Ultra Loop status, quality gate output, and aggregate checkpoint state prove completion.

${JSON.stringify({
  runId: run.runId,
  finalStatus,
  loopResult,
  steeringResult,
  qualityGate,
  aggregateCheckpoint,
  ledger
}, null, 2)}

Return exactly one JSON object matching the schema.`,
  schema: finalSummarySchema,
  structuredOutput: {
    transport: "auto"
  }
});

const workflowStatus =
  finalStatus.aggregateCompletion?.status === "complete"
    ? "complete"
    : finalStatus.status === "blocked"
      ? "blocked"
      : finalStatus.status === "needs_user_decision"
        ? "needs_user_decision"
        : aggregateCheckpoint?.ok === false
          ? "failed"
          : "in_progress";

export default {
  runId: run.runId,
  workflowStatus,
  aggregateStatus: finalStatus.aggregateCompletion?.status || null,
  goalSummary: finalStatus.counts || {},
  criteriaSummary: finalStatus.criteria || {},
  qualityGate,
  ledgerSummary: ledger.value?.summary || {},
  artifacts: {
    ultraLoopRunDir: `${storageRoot}/runs/${run.runId}`,
    planPath: `${storageRoot}/runs/${run.runId}/plan.json`,
    ledgerPath: `${storageRoot}/runs/${run.runId}/ledger.jsonl`,
    evidenceDir: `${storageRoot}/runs/${run.runId}/evidence`,
    qualityGateDir: `${storageRoot}/runs/${run.runId}/quality-gates`
  },
  steeringResult,
  loopResult,
  aggregateCheckpoint,
  summary: summarizer.json || summarizer,
  nextAction: summarizer.json?.nextAction || null
};
