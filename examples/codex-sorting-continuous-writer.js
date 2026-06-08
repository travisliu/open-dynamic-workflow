export const meta = {
  name: "codex-sorting-continuous-writer",
  description: "Writer A drafts three sorting algorithms continuously; reviewers test each completed draft on the side.",
  phases: ["write", "review", "summarize"]
};

const SPECS = [
  ["insertion", "Insertion sort", "insertionSort", "stable"],
  ["merge", "Merge sort", "mergeSort", "stable"],
  ["quick", "Quick sort", "quickSort", "state whether it is stable"]
];

const drafts = [];
const reviewTasks = [];
let pendingReview = null;

function writerPrompt([key, name, fn, stability], index) {
  return [
    "You are writer agent A. Stay on the critical path and continue the sequence.",
    `Draft ${index + 1}/3: ${name}.`,
    `Write JavaScript exporting ${fn}(values).`,
    "Do not mutate the input array. Cover empty arrays, duplicates, negatives, and sorted input.",
    `Stability requirement: ${stability}.`,
    "Return concise Markdown: design note, code block, complexity note.",
    drafts.length ? "Previous drafts:\n" + JSON.stringify(drafts, null, 2) : ""
  ].filter(Boolean).join("\n\n");
}

function reviewPrompt(spec, draft) {
  const [, name] = spec;
  return [
    `Review and mentally test this ${name} implementation.`,
    "Check correctness, input mutation, edge cases, complexity, and runnable API shape.",
    "Writer A must not wait for you; report only your independent evaluation.",
    "Return concise Markdown: verdict, test cases, issues, score /10.",
    draft.text
  ].join("\n\n");
}

for (let index = 0; index < SPECS.length; index += 1) {
  const spec = SPECS[index];
  const [key, name] = spec;

  phase("write");
  const draftPromise = agent(writerPrompt(spec, index), {
    id: `writer-a-${key}`,
    label: `Writer A: ${name}`,
    timeoutMs: 120000
  });

  if (pendingReview) {
    phase("review");
    reviewTasks.push(pendingReview());
  }

  const text = await draftPromise;
  const draft = { key, name, text };
  drafts.push(draft);

  pendingReview = () => agent(reviewPrompt(spec, draft), {
    id: `reviewer-${key}`,
    label: `Reviewer: ${name}`,
    optional: true,
    timeoutMs: 120000
  });
}

if (pendingReview) {
  phase("review");
  reviewTasks.push(pendingReview());
}

const reviews = await Promise.all(reviewTasks);

phase("summarize");

const summary = await agent([
  "Summarize the three sorting drafts and independent reviews.",
  "Call out any missing optional review as missing evidence.",
  "Return concise Markdown with ranking and next fixes.",
  JSON.stringify({ drafts, reviews }, null, 2)
].join("\n\n"), {
  id: "sorting-summary",
  label: "Sorting summary",
  timeoutMs: 120000
});

export default { drafts, reviews, summary };
