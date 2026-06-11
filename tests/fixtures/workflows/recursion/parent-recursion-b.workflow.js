export const meta = {
  name: "parent-recursion-b",
  description: "Recursive parent B"
};

export default async ({ workflow }) => {
  return await workflow({ name: "parent-recursion-a" });
};
