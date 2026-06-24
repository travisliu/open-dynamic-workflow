export const meta = {
  name: "ultra-loop-round",
  description: "Runs one Ultra Loop goal acquisition, evidence verification, and checkpoint round.",
  phases: ["acquire", "work", "evidence", "checkpoint", "status"]
};

const goalWorkerSchema = {
  type: "object",
  properties: {
    workSummary: { type: "string" },
    changedArtifacts: {
      type: "array",
      items: { type: "string" }
    },
    verificationPlan: {
      type: "array",
      items: { type: "string" }
    },
    evidenceCandidates: {
      type: "array",
      items: {
        type: "object",
        properties: {
          criterionId: { type: "string" },
          status: {
            type: "string",
            enum: ["pass", "fail", "blocked"]
          },
          evidence: { type: "string" },
          artifactRefs: {
            type: "array",
            items: { type: "string" }
          },
          notes: { type: "string" }
        },
        required: ["criterionId", "status", "evidence"]
      }
    },
    blockers: {
      type: "array",
      items: { type: "string" }
    },
    needsUserDecision: { type: "boolean" }
  },
  required: ["workSummary", "verificationPlan", "evidenceCandidates", "needsUserDecision"]
};

const evidenceVerifierSchema = {
  type: "object",
  properties: {
    verifiedEvidence: {
      type: "array",
      items: {
        type: "object",
        properties: {
          criterionId: { type: "string" },
          status: {
            type: "string",
            enum: ["pass", "fail", "blocked"]
          },
          evidence: { type: "string" },
          artifactRefs: {
            type: "array",
            items: { type: "string" }
          },
          verdict: {
            type: "string",
            enum: ["record", "reject", "needs_rerun"]
          },
          reason: { type: "string" }
        },
        required: ["criterionId", "status", "evidence", "verdict", "reason"]
      }
    }
  },
  required: ["verifiedEvidence"]
};

const checkpointReviewerSchema = {
  type: "object",
  properties: {
    recommendation: {
      type: "string",
      enum: [
        "checkpoint_complete",
        "checkpoint_failed",
        "checkpoint_blocked",
        "continue_work",
        "needs_user_decision"
      ]
    },
    summaryEvidence: { type: "string" },
    unresolvedCriteria: {
      type: "array",
      items: { type: "string" }
    },
    blockers: {
      type: "array",
      items: { type: "string" }
    }
  },
  required: ["recommendation", "summaryEvidence", "unresolvedCriteria", "blockers"]
};

const runId = String(args.runId || "");
const storageRoot = String(args.storageRoot || ".ultra-loop");
const artifactValidation =
  args.artifactValidation !== false && args.artifactValidation !== "false";
const roundNumber = typeof args.roundNumber === "number" ? args.roundNumber : 1;
const toolIdPrefix = `ultra-loop-round-${roundNumber}`;

if (runId.length === 0) {
  throw new Error("ultra-loop-round requires args.runId.");
}

phase("acquire");

const acquired = await tool({
  id: `${toolIdPrefix}-acquire-next`,
  definition: "ultra-loop.acquire-next",
  args: {
    runId,
    storageRoot
  }
});

let roundResult = {
  done: acquired.done === true,
  reason: acquired.reason || null,
  goalId: null,
  goalAttempt: null,
  status: null,
  checkpoint: null,
  recordedEvidenceCount: 0,
  nextAction: acquired.done === true ? "Proceed to final quality gate." : null
};

if (acquired.done !== true) {
  const goal = acquired.goal;
  const goalAttempt = goal.attempt || 1;
  const agentSuffix = `${goal.id}-attempt-${goalAttempt}`;

  phase("work");

  const work = await agent({
    id: `implement-goal-${agentSuffix}`,
    // The implementation role is intentionally autonomous and may modify the workspace.
    permissions: { mode: "dangerously-full-access" },
    prompt: `Work on this Ultra Loop goal.

Ultra Loop durable state and checkpoint tools are authoritative. Do not claim completion unless each success criterion has non-empty, observable evidence.

Goal:
${JSON.stringify(goal, null, 2)}

Constraints:
${JSON.stringify({
  artifactValidation,
  storageRoot
}, null, 2)}

Return exactly one JSON object matching the schema.`,
    schema: goalWorkerSchema,
    structuredOutput: {
      transport: "auto"
    }
  });

  phase("evidence");

  const verification = await agent({
    id: `verify-evidence-${agentSuffix}`,
    prompt: `Review these evidence candidates before Ultra Loop records them.

Classify each candidate as record, reject, or needs_rerun. Evidence marked record must be non-empty, observable, specific to the criterion, and safe to persist.

${JSON.stringify({
  goal,
  workerOutput: work.json || work,
  artifactValidation
}, null, 2)}

Return exactly one JSON object matching the schema.`,
    schema: evidenceVerifierSchema,
    structuredOutput: {
      transport: "auto"
    }
  });

  const verifiedEvidence = verification.json?.verifiedEvidence || [];
  const recordableEvidence = verifiedEvidence.filter(item => item.verdict === "record");

  for (const item of recordableEvidence) {
    await tool({
      id: `${toolIdPrefix}-record-evidence-${goal.id}-${item.criterionId}`,
      definition: "ultra-loop.record-evidence",
      args: {
        runId,
        storageRoot,
        goalId: goal.id,
        criterionId: item.criterionId,
        status: item.status,
        evidence: item.evidence,
        artifactRefs: item.artifactRefs || [],
        notes: item.reason
      },
      failureMode: "settled"
    });
  }

  phase("checkpoint");

  const checkpointReview = await agent({
    id: `checkpoint-review-${agentSuffix}`,
    prompt: `Advise whether the workflow should ask Ultra Loop to checkpoint this goal.

You are not the authority for completion. Ultra Loop checkpoint validation decides whether the state mutation is accepted.

${JSON.stringify({
  goal,
  workerOutput: work.json || work,
  verifiedEvidence
}, null, 2)}

Return exactly one JSON object matching the schema.`,
    schema: checkpointReviewerSchema,
    structuredOutput: {
      transport: "auto"
    }
  });

  const recommendation = checkpointReview.json?.recommendation || "continue_work";
  const checkpointStatus =
    recommendation === "checkpoint_complete"
      ? "complete"
      : recommendation === "checkpoint_blocked"
        ? "blocked"
        : recommendation === "needs_user_decision"
          ? "needs_user_decision"
          : recommendation === "checkpoint_failed"
            ? "failed"
            : "in_progress";

  const checkpoint = await tool({
      id: `${toolIdPrefix}-checkpoint-goal-${goal.id}`,
    definition: "ultra-loop.checkpoint",
    args: {
      runId,
      storageRoot,
      scope: "goal",
      goalId: goal.id,
      status: checkpointStatus,
      evidence: checkpointReview.json?.summaryEvidence || "Checkpoint review did not provide summary evidence.",
      snapshot: {
        agentId: `implement-goal-${agentSuffix}`,
        objective: goal.objective,
        attempt: goalAttempt,
        recordedEvidenceCount: recordableEvidence.length
      }
    },
    failureMode: "settled"
  });

  phase("status");

  const status = await tool({
    id: `${toolIdPrefix}-status-after-round`,
    definition: "ultra-loop.status",
    args: {
      runId,
      storageRoot
    }
  });

  const accepted = checkpoint.ok === true && checkpoint.value?.accepted === true;
  const needsUserDecision =
    checkpointStatus === "needs_user_decision" ||
    status.status === "needs_user_decision" ||
    status.status === "blocked";

  roundResult = {
    done: acquired.done === true || needsUserDecision,
    reason: needsUserDecision ? "NEEDS_USER_DECISION" : null,
    goalId: goal.id,
    goalAttempt,
    status,
    checkpoint,
    recordedEvidenceCount: recordableEvidence.length,
    nextAction: accepted
      ? "Acquire the next eligible goal."
      : needsUserDecision
        ? "Ask the user to resolve the blocker or steering decision."
        : "Retry or continue evidence gathering for the current goal."
  };
}

export default roundResult;
