export const meta = {
  name: "pause-resume-demo",
  description: "Minimal Codex workflow that pauses for a structured decision and resumes with cache",
  phases: ["Plan", "Approve", "Finish"]
};

phase("Plan");
const plan = await agent("Reply with exactly one short sentence: Plan: verify pause resume cache.", {
  id: "demo-plan",
  label: "Draft plan"
});

phase("Approve");
const decision = await pause("approve-plan", {
  message: "Review the plan and choose whether to continue.",
  data: { plan },
  schema: {
    type: "object",
    properties: {
      decision: { type: "string", enum: ["continue", "stop"] },
      instruction: { type: "string" }
    },
    required: ["decision"]
  }
});

phase("Finish");
let final;
if (decision.decision === "stop") {
  final = "Stopped after approval pause: " + (decision.instruction || "no instruction");
} else {
  final = await agent("Reply with exactly one short sentence: Final: pause resume cache works.", {
    id: "demo-final",
    label: "Final confirmation"
  });
}

export default {
  plan,
  decision,
  final
};
