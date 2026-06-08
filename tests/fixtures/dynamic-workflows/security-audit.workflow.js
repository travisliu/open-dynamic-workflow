export const meta = {
  name: "security-audit",
  description: "Small multi-perspective security audit workflow.",
  phases: ["audit", "dedupe"]
};

phase("audit");

const audits = await parallel({
  auth: () => agent("Audit authentication and authorization paths.", { id: "audit-auth", provider: "mock" }),
  data: () => agent("Audit data exposure and privacy risks.", { id: "audit-data", provider: "mock" }),
  injection: () => agent("Audit injection and unsafe command execution risks.", { id: "audit-injection", provider: "mock", optional: true })
});

phase("dedupe");

const deduped = await agent("Deduplicate and rank these security audit notes:\n" + JSON.stringify(audits, null, 2), {
  id: "security-dedupe",
  provider: "mock"
});

export default { audits, deduped };
