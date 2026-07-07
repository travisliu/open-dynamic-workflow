// @ts-ignore
import { defineAgent } from "@travisliu/open-dynamic-workflow";

export default defineAgent({
  // id is missing
  description: "Agent with missing ID",
  run: async () => {}
});
