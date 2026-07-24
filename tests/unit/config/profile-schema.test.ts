import { describe, expect, it } from "vitest";
import {
  validateConfig,
  validateProfileName,
  validateWorkflowProfile,
  validateProfileCatalog,
  validateResolvedWorkflowProfile
} from "../../../src/config/schema.js";
import { DEFAULT_CONFIG } from "../../../src/config/defaults.js";
import { OpenDynamicWorkflowError } from "../../../src/errors/types.js";
import { ErrorCode } from "../../../src/errors/codes.js";
import { ExitCode, exitCodeForError } from "../../../src/errors/exit-codes.js";

describe("Profile Schema Validation", () => {
  it("retains regression assertion that a config with no profiles still validates", () => {
    expect(() => validateConfig(DEFAULT_CONFIG)).not.toThrow();
  });

  it("passes with empty profiles catalog", () => {
    const config = {
      ...DEFAULT_CONFIG,
      profiles: {}
    };
    expect(() => validateConfig(config)).not.toThrow();
  });

  it("passes with a valid config profiles catalog", () => {
    const config = {
      ...DEFAULT_CONFIG,
      profiles: {
        "base-strict": {
          description: "A strict base profile",
          args: {
            qualityGate: "strict",
            nestedArray: [1, "two", { three: true }]
          },
          context: {
            qualityLevel: "strict"
          },
          run: {
            concurrency: 1,
            failFast: true,
            report: "json"
          }
        },
        "deep": {
          extends: "base-strict",
          args: {
            maxRounds: 5
          },
          context: {
            mode: "deep"
          }
        },
        "multi-extends": {
          extends: ["base-strict", "deep"]
        }
      }
    };
    expect(() => validateConfig(config)).not.toThrow();
  });

  describe("validateProfileName", () => {
    it("allows valid names", () => {
      expect(() => validateProfileName("ci", "path")).not.toThrow();
      expect(() => validateProfileName("deep-ci", "path")).not.toThrow();
      expect(() => validateProfileName("profile_123", "path")).not.toThrow();
    });

    it("rejects invalid types and empty strings", () => {
      expect(() => validateProfileName(123, "path")).toThrow(OpenDynamicWorkflowError);
      expect(() => validateProfileName("", "path")).toThrow(OpenDynamicWorkflowError);
    });

    it("rejects untrimmed names", () => {
      expect(() => validateProfileName(" ci", "path")).toThrow("must not have leading or trailing whitespace");
      expect(() => validateProfileName("ci ", "path")).toThrow("must not have leading or trailing whitespace");
    });

    it("rejects control characters", () => {
      expect(() => validateProfileName("ci\x01", "path")).toThrow("invalid control characters");
      expect(() => validateProfileName("ci\u0000", "path")).toThrow("invalid control characters");
    });

    it("rejects slashes and backslashes", () => {
      expect(() => validateProfileName("ci/deep", "path")).toThrow("contains invalid characters");
      expect(() => validateProfileName("ci\\deep", "path")).toThrow("contains invalid characters");
    });

    it("rejects dot and double dot", () => {
      expect(() => validateProfileName(".", "path")).toThrow("is reserved");
      expect(() => validateProfileName("..", "path")).toThrow("is reserved");
    });

    it("rejects prototype-polluting keys", () => {
      expect(() => validateProfileName("__proto__", "path")).toThrow("is reserved");
      expect(() => validateProfileName("prototype", "path")).toThrow("is reserved");
      expect(() => validateProfileName("constructor", "path")).toThrow("is reserved");
    });
  });

  describe("validateProfileCatalog", () => {
    it("rejects invalid catalog types", () => {
      expect(() => validateProfileCatalog(null)).toThrow("must be a non-null object");
      expect(() => validateProfileCatalog([])).toThrow("must be a non-null object");
      expect(() => validateProfileCatalog("not-an-object")).toThrow("must be a non-null object");
    });

    it("rejects catalog with invalid name key", () => {
      expect(() => validateProfileCatalog({ "invalid/name": {} })).toThrow("contains invalid characters");
    });
  });

  describe("validateWorkflowProfile", () => {
    it("rejects non-object profiles", () => {
      expect(() => validateWorkflowProfile(null, "profiles.p")).toThrow("must be an object");
      expect(() => validateWorkflowProfile([], "profiles.p")).toThrow("must be an object");
    });

    it("rejects unknown profile keys", () => {
      expect(() => validateWorkflowProfile({ security: {} }, "profiles.p")).toThrow(
        "profiles.p.security is not allowed. Profiles may configure only description, extends, args, context, run, and outDir."
      );
      expect(() => validateWorkflowProfile({ unknownKey: true }, "profiles.p")).toThrow(
        "profiles.p.unknownKey is not allowed"
      );
    });

    it("rejects invalid description type", () => {
      expect(() => validateWorkflowProfile({ description: 123 }, "profiles.p")).toThrow("must be a string");
    });

    it("rejects invalid extends type or values", () => {
      expect(() => validateWorkflowProfile({ extends: 123 }, "profiles.p")).toThrow("must be a string");
      expect(() => validateWorkflowProfile({ extends: [] }, "profiles.p")).toThrow("must be a non-empty array");
      expect(() => validateWorkflowProfile({ extends: ["valid", "invalid/name"] }, "profiles.p")).toThrow(
        "contains invalid characters"
      );
    });

    describe("args and context JSON-safety validation", () => {
      it("rejects non-object args or context", () => {
        expect(() => validateWorkflowProfile({ args: "not-an-obj" }, "profiles.p")).toThrow("must be a JSON-safe object");
        expect(() => validateWorkflowProfile({ context: [] }, "profiles.p")).toThrow("must be a JSON-safe object");
        expect(() => validateWorkflowProfile({ args: null }, "profiles.p")).toThrow("must be a JSON-safe object");
      });

      it("rejects unsafe properties and invalid JSON types in args", () => {
        expect(() => validateWorkflowProfile({ args: { a: undefined } }, "profiles.p")).toThrow("cannot be undefined");
        expect(() => validateWorkflowProfile({ args: { a: () => {} } }, "profiles.p")).toThrow("cannot be a function");
        expect(() => validateWorkflowProfile({ args: { a: Symbol("sym") } }, "profiles.p")).toThrow("cannot be a symbol");
        expect(() => validateWorkflowProfile({ args: { a: 123n } }, "profiles.p")).toThrow("cannot be a bigint");
        expect(() => validateWorkflowProfile({ args: { a: NaN } }, "profiles.p")).toThrow("must be a finite number");
      });

      it("rejects unsafe keys inside args", () => {
        expect(() => validateWorkflowProfile({ args: { "__proto__": {} } }, "profiles.p")).toThrow("is an unsafe object key");
        expect(() => validateWorkflowProfile({ args: { "constructor": {} } }, "profiles.p")).toThrow("is an unsafe object key");
      });

      it("rejects inherited enumerable values in args", () => {
        const proto = { inherited: 123 };
        const argsObj = Object.create(proto);
        argsObj.own = 456;
        expect(() => validateWorkflowProfile({ args: argsObj }, "profiles.p")).toThrow(
          "contains inherited enumerable property 'inherited'"
        );
      });

      it("allows valid nested structures in args", () => {
        expect(() => validateWorkflowProfile({
          args: {
            a: 123,
            b: "str",
            c: true,
            d: null,
            e: [1, 2, { x: "y" }],
            f: { nested: { val: true } }
          }
        }, "profiles.p")).not.toThrow();
      });

      it("rejects reserved context.$profile key", () => {
        expect(() => validateWorkflowProfile({ context: { "$profile": {} } }, "profiles.p")).toThrow(
          "profiles.p.context.$profile is reserved"
        );
      });
    });

    describe("JSON-safety hardening", () => {
      it("rejects cyclic args object and cyclic context array, throwing PROFILE_VALIDATION_ERROR", () => {
        const cyclicObj: any = {};
        cyclicObj.self = cyclicObj;
        expect(() => validateWorkflowProfile({ args: cyclicObj }, "profiles.p")).toThrow(OpenDynamicWorkflowError);

        const cyclicArr: any[] = [];
        cyclicArr.push(cyclicArr);
        expect(() => validateWorkflowProfile({ context: { arr: cyclicArr } }, "profiles.p")).toThrow(OpenDynamicWorkflowError);
      });

      it("rejects inherited unknown and allowed fields on profile and run objects", () => {
        const protoProfile = { description: "inherited description", unknownField: 123 };
        const profileObj = Object.create(protoProfile);
        profileObj.extends = "base";
        expect(() => validateWorkflowProfile(profileObj, "profiles.p")).toThrow("contains inherited enumerable property");

        const protoRun = { provider: "inherited-provider", unknownField: 123 };
        const runObj = Object.create(protoRun);
        runObj.model = "gpt";
        expect(() => validateWorkflowProfile({ run: runObj }, "profiles.p")).toThrow("contains inherited enumerable property");
      });

      it("rejects non-enumerable or accessor keys on profile and run objects", () => {
        // non-enumerable profile key
        const profileObj1 = {};
        Object.defineProperty(profileObj1, "extends", {
          value: "base",
          enumerable: false,
          configurable: true,
          writable: true
        });
        expect(() => validateWorkflowProfile(profileObj1, "profiles.p")).toThrow("is a non-enumerable key");

        // accessor profile key
        const profileObj2 = {};
        Object.defineProperty(profileObj2, "description", {
          get() { return "accessor description"; },
          enumerable: true,
          configurable: true
        });
        expect(() => validateWorkflowProfile(profileObj2, "profiles.p")).toThrow("is an accessor");

        // accessor run key
        const runObj = {};
        Object.defineProperty(runObj, "provider", {
          get() { return "accessor-provider"; },
          enumerable: true,
          configurable: true
        });
        expect(() => validateWorkflowProfile({ run: runObj }, "profiles.p")).toThrow("is an accessor");
      });

      it("allows valid ordinary plain YAML/JavaScript profile objects", () => {
        expect(() => validateWorkflowProfile({
          description: "valid description",
          extends: "base",
          args: { a: 1 },
          context: { b: 2 },
          run: { provider: "mock", concurrency: 3 }
        }, "profiles.p")).not.toThrow();
      });
    });

    describe("run options validation", () => {
      it("rejects non-object run options", () => {
        expect(() => validateWorkflowProfile({ run: "invalid" }, "profiles.p")).toThrow("must be an object");
      });

      it("rejects unknown run keys", () => {
        expect(() => validateWorkflowProfile({ run: { providers: {} } }, "profiles.p")).toThrow(
          "profiles.p.run.providers is not allowed"
        );
        expect(() => validateWorkflowProfile({ run: { command: "node" } }, "profiles.p")).toThrow(
          "profiles.p.run.command is not allowed"
        );
      });

      it("rejects invalid types/boundaries", () => {
        expect(() => validateWorkflowProfile({ run: { provider: "" } }, "profiles.p")).toThrow("must be a non-empty string");
        expect(() => validateWorkflowProfile({ run: { model: "" } }, "profiles.p")).toThrow("must be a non-empty string");
        expect(() => validateWorkflowProfile({ run: { concurrency: 0 } }, "profiles.p")).toThrow("must be a positive integer");
        expect(() => validateWorkflowProfile({ run: { timeoutMs: 1.5 } }, "profiles.p")).toThrow("must be a positive integer");
        expect(() => validateWorkflowProfile({ run: { maxAgentCalls: -10 } }, "profiles.p")).toThrow("must be a positive integer");
        expect(() => validateWorkflowProfile({ run: { failFast: "true" as any } }, "profiles.p")).toThrow("must be a boolean");
        expect(() => validateWorkflowProfile({ run: { report: "invalid" as any } }, "profiles.p")).toThrow("must be one of");
        expect(() => validateWorkflowProfile({ run: { thinkingEffort: "invalid" as any } }, "profiles.p")).toThrow("must be one of");
      });

      it("validates retry and translates config-validation errors to profile paths", () => {
        // invalid retry type
        expect(() => validateWorkflowProfile({ run: { retry: [] as any } }, "profiles.p")).toThrow(
          "Config value 'profiles.p.run.retry' must be an object"
        );

        // invalid maxAttempts
        expect(() => validateWorkflowProfile({ run: { retry: { maxAttempts: 0 } } }, "profiles.p")).toThrow(
          "Config value 'profiles.p.run.retry.maxAttempts' must be a positive integer"
        );

        // invalid delayMs
        expect(() => validateWorkflowProfile({ run: { retry: { delayMs: -1 } } }, "profiles.p")).toThrow(
          "Config value 'profiles.p.run.retry.delayMs' must be a non-negative integer"
        );

        // invalid policy nested structure
        expect(() => validateWorkflowProfile({ run: { retry: { policy: { maxAttempts: 0 } } } }, "profiles.p")).toThrow(
          "Config value 'profiles.p.run.retry.policy.maxAttempts' must be a positive integer"
        );

        // valid retry
        expect(() => validateWorkflowProfile({ run: { retry: { maxAttempts: 3 } } }, "profiles.p")).not.toThrow();
        expect(() => validateWorkflowProfile({ run: { retry: false } }, "profiles.p")).not.toThrow();
      });
    });
  });

  describe("validateResolvedWorkflowProfile", () => {
    const validResolved = {
      description: "Resolved description",
      args: { a: 1 },
      context: { b: 2 },
      run: { provider: "mock", model: "model" }
    };

    it("passes a valid resolved profile", () => {
      expect(() => validateResolvedWorkflowProfile(validResolved, "resolved")).not.toThrow();
    });

    it("rejects extends in resolved profile", () => {
      expect(() => validateResolvedWorkflowProfile({ ...validResolved, extends: "base" }, "resolved")).toThrow(
        "must not contain 'extends'"
      );
    });

    it("rejects missing args, context, or run", () => {
      const { args, ...missingArgs } = validResolved;
      expect(() => validateResolvedWorkflowProfile(missingArgs, "resolved")).toThrow("resolved.args is missing");

      const { context, ...missingContext } = validResolved;
      expect(() => validateResolvedWorkflowProfile(missingContext, "resolved")).toThrow("resolved.context is missing");

      const { run, ...missingRun } = validResolved;
      expect(() => validateResolvedWorkflowProfile(missingRun, "resolved")).toThrow("resolved.run is missing");
    });

    it("validates run and context.$profile in resolved profile", () => {
      expect(() => validateResolvedWorkflowProfile({
        ...validResolved,
        context: { "$profile": {} }
      }, "resolved")).toThrow("resolved.context.$profile is reserved");

      expect(() => validateResolvedWorkflowProfile({
        ...validResolved,
        run: { provider: "" }
      }, "resolved")).toThrow("must be a non-empty string");
    });
  });

  describe("nested value and retry descriptor safety", () => {
    it("rejects accessor-backed array elements without executing the getter", () => {
      let executed = false;
      const arr = [];
      Object.defineProperty(arr, "0", {
        get() {
          executed = true;
          return "unsafe-value";
        },
        enumerable: true,
        configurable: true
      });
      expect(() => validateWorkflowProfile({ args: { arr } }, "profiles.p")).toThrow(OpenDynamicWorkflowError);
      expect(executed).toBe(false);
    });

    it("rejects arrays with extra, symbol, non-enumerable, or accessor properties", () => {
      // Extra custom property
      const arr1 = [1, 2];
      (arr1 as any).extra = undefined;
      expect(() => validateWorkflowProfile({ args: { arr: arr1 } }, "profiles.p")).toThrow("contains unexpected own properties");

      // Symbol property
      const arr2 = [1, 2];
      const sym = Symbol("extra");
      (arr2 as any)[sym] = 3;
      expect(() => validateWorkflowProfile({ args: { arr: arr2 } }, "profiles.p")).toThrow("must not contain symbol keys");

      // Non-enumerable property
      const arr3 = [1, 2];
      Object.defineProperty(arr3, "extra", {
        value: 3,
        enumerable: false,
        configurable: true,
        writable: true
      });
      expect(() => validateWorkflowProfile({ args: { arr: arr3 } }, "profiles.p")).toThrow("contains unexpected own properties");

      // Accessor property
      const arr4 = [1, 2];
      Object.defineProperty(arr4, "extra", {
        get() { return 3; },
        enumerable: true,
        configurable: true
      });
      expect(() => validateWorkflowProfile({ args: { arr: arr4 } }, "profiles.p")).toThrow("contains unexpected own properties");

      // Sparse array (hole)
      const arr5 = [1];
      arr5[2] = 3; // hole at index 1
      expect(() => validateWorkflowProfile({ args: { arr: arr5 } }, "profiles.p")).toThrow("contains a hole at index 1");
    });

    it("allows valid ordinary nested arrays", () => {
      const arr = [1, [2, { a: 3 }]];
      expect(() => validateWorkflowProfile({ args: { arr } }, "profiles.p")).not.toThrow();
    });

    it("rejects inherited, non-enumerable, symbol, and accessor-backed run.retry.policy fields without executing getters", () => {
      let executed = false;

      // Accessor-backed run.retry.policy field
      const policy1 = {};
      Object.defineProperty(policy1, "maxAttempts", {
        get() {
          executed = true;
          return 3;
        },
        enumerable: true,
        configurable: true
      });
      expect(() => validateWorkflowProfile({ run: { retry: { policy: policy1 } } }, "profiles.p")).toThrow(OpenDynamicWorkflowError);
      expect(executed).toBe(false);

      // Inherited run.retry.policy field
      const proto = { maxAttempts: 3 };
      const policy2 = Object.create(proto);
      expect(() => validateWorkflowProfile({ run: { retry: { policy: policy2 } } }, "profiles.p")).toThrow(OpenDynamicWorkflowError);

      // Symbol run.retry.policy key
      const policy3 = { maxAttempts: 3 };
      Object.defineProperty(policy3, Symbol("extra"), {
        value: "sym",
        enumerable: true,
        configurable: true,
        writable: true
      });
      expect(() => validateWorkflowProfile({ run: { retry: { policy: policy3 } } }, "profiles.p")).toThrow(OpenDynamicWorkflowError);

      // Non-enumerable run.retry.policy field
      const policy4 = { maxAttempts: 3 };
      Object.defineProperty(policy4, "delayMs", {
        value: 1000,
        enumerable: false,
        configurable: true,
        writable: true
      });
      expect(() => validateWorkflowProfile({ run: { retry: { policy: policy4 } } }, "profiles.p")).toThrow(OpenDynamicWorkflowError);
    });

    it("allows valid ordinary retry policy configuration", () => {
      expect(() => validateWorkflowProfile({
        run: {
          retry: {
            policy: {
              maxAttempts: 3,
              delayMs: 1000,
              backoff: "exponential"
            }
          }
        }
      }, "profiles.p")).not.toThrow();

      expect(() => validateWorkflowProfile({
        run: {
          retry: {
            maxAttempts: 3,
            delayMs: 1000,
            backoff: "exponential"
          }
        }
      }, "profiles.p")).not.toThrow();
    });
  });

  describe("Exit Code Mappings", () => {
    it("maps PROFILE_NOT_FOUND and PROFILE_FILE_NOT_FOUND to ExitCode.ResourceNotFound", () => {
      expect(exitCodeForError(new OpenDynamicWorkflowError(ErrorCode.PROFILE_NOT_FOUND, "msg"))).toBe(
        ExitCode.ResourceNotFound
      );
      expect(exitCodeForError(new OpenDynamicWorkflowError(ErrorCode.PROFILE_FILE_NOT_FOUND, "msg"))).toBe(
        ExitCode.ResourceNotFound
      );
    });

    it("maps other profile errors to ExitCode.CLI_USAGE_ERROR", () => {
      expect(exitCodeForError(new OpenDynamicWorkflowError(ErrorCode.PROFILE_FILE_INVALID, "msg"))).toBe(
        ExitCode.CLI_USAGE_ERROR
      );
      expect(exitCodeForError(new OpenDynamicWorkflowError(ErrorCode.PROFILE_VALIDATION_ERROR, "msg"))).toBe(
        ExitCode.CLI_USAGE_ERROR
      );
      expect(exitCodeForError(new OpenDynamicWorkflowError(ErrorCode.PROFILE_CONTEXT_INVALID, "msg"))).toBe(
        ExitCode.CLI_USAGE_ERROR
      );
      expect(exitCodeForError(new OpenDynamicWorkflowError(ErrorCode.PROFILE_RESERVED_PATH, "msg"))).toBe(
        ExitCode.CLI_USAGE_ERROR
      );
      expect(exitCodeForError(new OpenDynamicWorkflowError(ErrorCode.PROFILE_OPTION_CONFLICT, "msg"))).toBe(
        ExitCode.CLI_USAGE_ERROR
      );
    });
  });
});
