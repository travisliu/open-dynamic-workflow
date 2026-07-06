import { describe, expect, it } from "vitest";
import { serializeError } from "../../../src/errors/serialize.js";
import { OpenDynamicWorkflowError } from "../../../src/errors/types.js";
import { ErrorCode } from "../../../src/errors/codes.js";

describe("Error Serialization", () => {
  it("serializes RETRY_EXHAUSTED error and preserves the underlying cause", () => {
    const underlying = new Error("Provider execution failed");
    const err = new OpenDynamicWorkflowError(ErrorCode.RETRY_EXHAUSTED, "Agent retry attempts exhausted", {
      cause: underlying
    });

    const serialized = serializeError(err);
    expect(serialized.name).toBe("OpenDynamicWorkflowError");
    expect(serialized.code).toBe("RETRY_EXHAUSTED");
    expect(serialized.message).toBe("Agent retry attempts exhausted");
    expect(serialized.cause).toBeDefined();
    
    const serializedCause = serialized.cause as any;
    expect(serializedCause.name).toBe("Error");
    expect(serializedCause.message).toBe("Provider execution failed");
  });
});
