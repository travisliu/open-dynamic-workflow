// @ts-ignore
import { defineAgent } from "@travisliu/open-dynamic-workflow";

export default defineAgent({
  id: "duplicate-agent",
  description: "Second duplicate agent",
  run: async () => {}
});
