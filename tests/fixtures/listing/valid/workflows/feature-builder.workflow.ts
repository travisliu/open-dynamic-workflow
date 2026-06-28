export const meta = {
  name: "feature-builder",
  description: "Builds a feature from requirements.",
  phases: ["planning", "implementation", "review"],
  version: "1.0.0",
  tags: ["feature"]
};

export default async function workflow() {
  throw new Error("list must not execute workflow body");
}
