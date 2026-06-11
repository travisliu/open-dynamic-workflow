export const meta = {
  name: "child-fails",
  description: "Child that fails"
};

throw new Error("Deterministic child failure");
