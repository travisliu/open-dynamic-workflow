import { describe, expect, it, afterAll, beforeAll } from "vitest";
import * as os from "os";
import * as fs from "fs";
import * as path from "path";
import { loadExternalProfilesFile } from "../../../src/config/profile-file.js";

describe("loadExternalProfilesFile", () => {
  let tempDir: string;
  let workspaceDir: string;
  let symlinksSupported = true;

  beforeAll(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "profile-file-test-"));
    workspaceDir = path.join(tempDir, "workspace");
    fs.mkdirSync(workspaceDir);

    try {
      const testLink = path.join(tempDir, "test-symlink-support");
      fs.symlinkSync("target", testLink);
      fs.unlinkSync(testLink);
    } catch (e) {
      symlinksSupported = false;
    }
  });

  afterAll(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  async function assertThrows(
    promise: Promise<any>,
    code: string,
    messageFragment: string
  ) {
    try {
      await promise;
      throw new Error("Expected to throw but succeeded");
    } catch (err: any) {
      expect(err.name).toBe("OpenDynamicWorkflowError");
      expect(err.code).toBe(code);
      expect(err.message.toLowerCase()).toContain(messageFragment.toLowerCase());
    }
  }

  it("omitted path -> undefined", async () => {
    const res = await loadExternalProfilesFile({ cwd: workspaceDir });
    expect(res).toBeUndefined();
  });

  it("empty or whitespace path -> PROFILE_FILE_INVALID", async () => {
    await assertThrows(
      loadExternalProfilesFile({ cwd: workspaceDir, profilesPath: "" }),
      "PROFILE_FILE_INVALID",
      "empty or whitespace-only"
    );
    await assertThrows(
      loadExternalProfilesFile({ cwd: workspaceDir, profilesPath: "   " }),
      "PROFILE_FILE_INVALID",
      "empty or whitespace-only"
    );
  });

  it("valid .yaml and .yml files return typed profiles, canonical path, and POSIX cwd-relative displayPath", async () => {
    const yamlPath = path.join(workspaceDir, "profiles.yaml");
    fs.writeFileSync(yamlPath, `
description: "My external profiles"
version: "1.0"
profiles:
  development:
    description: "Dev profile"
    run:
      provider: "mock"
      model: "gpt-4"
`);

    const res1 = await loadExternalProfilesFile({ cwd: workspaceDir, profilesPath: "profiles.yaml" });
    expect(res1).toBeDefined();
    expect(res1?.document.description).toBe("My external profiles");
    expect(res1?.document.version).toBe("1.0");
    expect(res1?.document.profiles.development.description).toBe("Dev profile");
    expect(res1?.path).toBe(fs.realpathSync(yamlPath));
    expect(res1?.displayPath).toBe("profiles.yaml");

    const ymlPath = path.join(workspaceDir, "profiles.yml");
    fs.writeFileSync(ymlPath, `
profiles:
  production:
    description: "Prod profile"
`);

    const res2 = await loadExternalProfilesFile({ cwd: workspaceDir, profilesPath: "profiles.yml" });
    expect(res2).toBeDefined();
    expect(res2?.document.profiles.production.description).toBe("Prod profile");
    expect(res2?.path).toBe(fs.realpathSync(ymlPath));
    expect(res2?.displayPath).toBe("profiles.yml");
  });

  it("missing file -> PROFILE_FILE_NOT_FOUND", async () => {
    await assertThrows(
      loadExternalProfilesFile({ cwd: workspaceDir, profilesPath: "missing.yaml" }),
      "PROFILE_FILE_NOT_FOUND",
      "not found"
    );
  });

  it("non-YAML extension -> PROFILE_FILE_INVALID", async () => {
    const jsonPath = path.join(workspaceDir, "profiles.json");
    fs.writeFileSync(jsonPath, "{}");
    await assertThrows(
      loadExternalProfilesFile({ cwd: workspaceDir, profilesPath: "profiles.json" }),
      "PROFILE_FILE_INVALID",
      "extension"
    );
  });

  it("URL-like path -> PROFILE_FILE_INVALID", async () => {
    await assertThrows(
      loadExternalProfilesFile({ cwd: workspaceDir, profilesPath: "https://example.com/profiles.yaml" }),
      "PROFILE_FILE_INVALID",
      "URL-like"
    );
    await assertThrows(
      loadExternalProfilesFile({ cwd: workspaceDir, profilesPath: "file://localhost/profiles.yaml" }),
      "PROFILE_FILE_INVALID",
      "URL-like"
    );
  });

  it("relative ../ and absolute outside-workspace attempts -> PROFILE_FILE_INVALID", async () => {
    await assertThrows(
      loadExternalProfilesFile({ cwd: workspaceDir, profilesPath: "../profiles.yaml" }),
      "PROFILE_FILE_INVALID",
      "resolves outside the workspace"
    );
    // Absolute outside CWD (we use tempDir as parent, which is outside workspaceDir)
    const absOutside = path.join(tempDir, "outside.yaml");
    await assertThrows(
      loadExternalProfilesFile({ cwd: workspaceDir, profilesPath: absOutside }),
      "PROFILE_FILE_INVALID",
      "resolves outside the workspace"
    );
  });

  it("malformed YAML -> PROFILE_FILE_INVALID", async () => {
    const badYamlPath = path.join(workspaceDir, "bad.yaml");
    fs.writeFileSync(badYamlPath, "profiles: {");
    await assertThrows(
      loadExternalProfilesFile({ cwd: workspaceDir, profilesPath: "bad.yaml" }),
      "PROFILE_FILE_INVALID",
      "yaml"
    );
  });

  it("duplicate profile keys -> PROFILE_FILE_INVALID", async () => {
    const dupYamlPath = path.join(workspaceDir, "dup.yaml");
    fs.writeFileSync(dupYamlPath, `
profiles:
  dev:
    description: "Dev 1"
  dev:
    description: "Dev 2"
`);
    await assertThrows(
      loadExternalProfilesFile({ cwd: workspaceDir, profilesPath: "dup.yaml" }),
      "PROFILE_FILE_INVALID",
      "keys must be unique"
    );
  });

  it("empty/non-object/array roots, missing/invalid profiles, bad description/version, and unsupported envelope key -> PROFILE_FILE_INVALID", async () => {
    // Empty root
    const emptyYamlPath = path.join(workspaceDir, "empty.yaml");
    fs.writeFileSync(emptyYamlPath, "");
    await assertThrows(
      loadExternalProfilesFile({ cwd: workspaceDir, profilesPath: "empty.yaml" }),
      "PROFILE_FILE_INVALID",
      "root of profiles file must be a non-null, non-array object"
    );

    // Array root
    const arrayYamlPath = path.join(workspaceDir, "array.yaml");
    fs.writeFileSync(arrayYamlPath, "- profiles: {}");
    await assertThrows(
      loadExternalProfilesFile({ cwd: workspaceDir, profilesPath: "array.yaml" }),
      "PROFILE_FILE_INVALID",
      "root of profiles file must be a non-null, non-array object"
    );

    // Missing profiles
    const missingProfPath = path.join(workspaceDir, "missing-prof.yaml");
    fs.writeFileSync(missingProfPath, "description: hello");
    await assertThrows(
      loadExternalProfilesFile({ cwd: workspaceDir, profilesPath: "missing-prof.yaml" }),
      "PROFILE_FILE_INVALID",
      "missing required envelope key: profiles"
    );

    // Bad description
    const badDescPath = path.join(workspaceDir, "bad-desc.yaml");
    fs.writeFileSync(badDescPath, `
profiles: {}
description: 123
`);
    await assertThrows(
      loadExternalProfilesFile({ cwd: workspaceDir, profilesPath: "bad-desc.yaml" }),
      "PROFILE_FILE_INVALID",
      "envelope key 'description' must be a string"
    );

    // Bad version
    const badVerPath = path.join(workspaceDir, "bad-ver.yaml");
    fs.writeFileSync(badVerPath, `
profiles: {}
version: 1.0
`);
    await assertThrows(
      loadExternalProfilesFile({ cwd: workspaceDir, profilesPath: "bad-ver.yaml" }),
      "PROFILE_FILE_INVALID",
      "envelope key 'version' must be a string"
    );

    // Unsupported envelope key
    const badKeyPath = path.join(workspaceDir, "bad-key.yaml");
    fs.writeFileSync(badKeyPath, `
profiles: {}
extraKey: value
`);
    await assertThrows(
      loadExternalProfilesFile({ cwd: workspaceDir, profilesPath: "bad-key.yaml" }),
      "PROFILE_FILE_INVALID",
      "unsupported envelope key: extrakey"
    );

    // Prototype pollution attempt key
    const badProtoPath = path.join(workspaceDir, "bad-proto.yaml");
    fs.writeFileSync(badProtoPath, `
profiles: {}
__proto__: value
`);
    await assertThrows(
      loadExternalProfilesFile({ cwd: workspaceDir, profilesPath: "bad-proto.yaml" }),
      "PROFILE_FILE_INVALID",
      "unsupported envelope key: __proto__"
    );
  });

  it("a schema-invalid profile is delegated and retains PROFILE_VALIDATION_ERROR", async () => {
    const badSchemaPath = path.join(workspaceDir, "bad-schema.yaml");
    fs.writeFileSync(badSchemaPath, `
profiles:
  dev:
    description: 123
`);
    await assertThrows(
      loadExternalProfilesFile({ cwd: workspaceDir, profilesPath: "bad-schema.yaml" }),
      "PROFILE_VALIDATION_ERROR",
      "must be a string"
    );
  });

  it("file or directory symlink escape -> PROFILE_FILE_INVALID", async () => {
    if (!symlinksSupported) {
      return;
    }

    // file symlink escape
    const fileOutside = path.join(tempDir, "outside.yaml");
    fs.writeFileSync(fileOutside, `
profiles:
  dev:
    description: "outside"
`);
    const linkInside = path.join(workspaceDir, "link-outside.yaml");
    fs.symlinkSync(fileOutside, linkInside);

    await assertThrows(
      loadExternalProfilesFile({ cwd: workspaceDir, profilesPath: "link-outside.yaml" }),
      "PROFILE_FILE_INVALID",
      "outside"
    );

    // directory symlink escape
    const dirOutside = path.join(tempDir, "outside-dir");
    fs.mkdirSync(dirOutside);
    const fileInDirOutside = path.join(dirOutside, "outside-profile.yaml");
    fs.writeFileSync(fileInDirOutside, `
profiles:
  dev:
    description: "outside"
`);
    const linkDirInside = path.join(workspaceDir, "link-outside-dir");
    fs.symlinkSync(dirOutside, linkDirInside);

    await assertThrows(
      loadExternalProfilesFile({ cwd: workspaceDir, profilesPath: "link-outside-dir/outside-profile.yaml" }),
      "PROFILE_FILE_INVALID",
      "outside"
    );
  });

  it("rejects YAML anchor/alias cycle -> PROFILE_VALIDATION_ERROR", async () => {
    const cycleYamlPath = path.join(workspaceDir, "cycle.yaml");
    fs.writeFileSync(cycleYamlPath, `
profiles:
  dev:
    args: &a
      self: *a
`);
    await assertThrows(
      loadExternalProfilesFile({ cwd: workspaceDir, profilesPath: "cycle.yaml" }),
      "PROFILE_VALIDATION_ERROR",
      "cyclic reference"
    );
  });
});
