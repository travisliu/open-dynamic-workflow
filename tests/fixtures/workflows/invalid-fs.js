export const meta = {
  name: "invalid-fs",
  description: "Uses fs"
};

const text = fs.readFileSync("package.json", "utf8");
export default { text };
