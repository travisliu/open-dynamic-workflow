export const meta = {
  name: "valid-with-phases",
  description: "A valid workflow with phases",
  phases: ["scan", "review", "summarize"]
};

phase("scan");
phase("review");
phase("summarize");

export default { ok: true };
