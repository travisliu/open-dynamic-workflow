export const meta = {
  name: "invalid-process",
  description: "Uses process"
};

const cwd = process.cwd();
export default { cwd };
