import { EXIT_CODES } from "../../types/errors.js";

export async function doctorCommand(): Promise<number> {
  console.error("[phase0] doctor command routed.");
  console.error("[phase0] provider health checks are intentionally not included yet.");
  return EXIT_CODES.SUCCESS;
}
