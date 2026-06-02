export const meta = {
  name: "runtime-simple",
  description: "Simple runtime test with phase and log",
  phases: ["start"]
};

phase("start");
log("hello from simple workflow");

export default { ok: true };
