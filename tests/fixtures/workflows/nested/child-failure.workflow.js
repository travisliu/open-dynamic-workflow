export const meta = {
  name: "child-failure",
  description: "Child that throws"
};

export default async () => {
  throw new Error("intentional child failure");
};
