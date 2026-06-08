export const meta = {
  name: "loop-until-dry",
  description: "Small deterministic loop-until-dry workflow.",
  phases: ["search", "summarize"]
};

phase("search");

const rounds = [];
for (const round of [1, 2]) {
  const finding = await agent(`Find new issues in round ${round}. Return only novel items.`, {
    id: `issue-search-round-${round}`,
    provider: "mock"
  });
  rounds.push(finding);
}

phase("summarize");

const summary = await agent("Summarize the loop-until-dry findings:\n" + JSON.stringify(rounds, null, 2), {
  id: "loop-summary",
  provider: "mock"
});

export default { rounds, summary };
