export const meta = {
  name: "provider-alias-phase3",
  description: "Public provider alias acceptance fixture"
};

export default async () => {
  const aliased = await agent({
    id: "aliased",
    provider: "review-alias",
    prompt: "Run the aliased review."
  });

  const direct = await agent({
    id: "direct",
    provider: "codex",
    prompt: "Run the direct review."
  });

  return { aliased, direct };
};
