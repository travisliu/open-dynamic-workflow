export const meta = {
  name: "parent-recursion-a",
  description: "Recursive parent A"
};

export default async () => {
  return await workflow({ name: "parent-recursion-b" });
};
