export const meta = {
  name: "depth-2",
  description: "depth 2"
};

export default async ({ workflow }) => {
  return await workflow({ name: "depth-3" });
};
