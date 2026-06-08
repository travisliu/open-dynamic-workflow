export const meta = {
  name: "judge-panel",
  description: "Small judge-panel workflow for comparing implementation plans.",
  phases: ["propose", "judge", "decide"]
};

phase("propose");

const proposals = await parallel([
  () => agent("Propose a conservative implementation plan.", { id: "proposal-conservative", provider: "mock" }),
  () => agent("Propose a fast implementation plan.", { id: "proposal-fast", provider: "mock" })
]);

phase("judge");

const judges = await parallel({
  correctness: () => agent("Judge these proposals for correctness:\n" + JSON.stringify(proposals, null, 2), { id: "judge-correctness", provider: "mock" }),
  maintainability: () => agent("Judge these proposals for maintainability:\n" + JSON.stringify(proposals, null, 2), { id: "judge-maintainability", provider: "mock" })
});

phase("decide");

const decision = await agent("Choose the best proposal and cite judge reasoning:\n" + JSON.stringify({ proposals, judges }, null, 2), {
  id: "judge-decision",
  provider: "mock"
});

export default { proposals, judges, decision };
