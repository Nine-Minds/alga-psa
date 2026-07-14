import { spawnSync } from "node:child_process";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const temporalRoot = path.resolve(currentDir, "../../..");
const scriptPath = path.join(
  temporalRoot,
  "src/scripts/upgrade-tenant-product.ts",
);
const tenantId = "11111111-2222-4333-8444-555555555555";

function runCli(args: string[]) {
  return spawnSync(process.execPath, ["--import", "tsx", scriptPath, ...args], {
    cwd: temporalRoot,
    env: {
      ...process.env,
      TEMPORAL_TEST_SKIP_ENV_BOOTSTRAP: "1",
    },
    encoding: "utf8",
    timeout: 30_000,
  });
}

describe("upgrade tenant product CLI arguments", () => {
  it("T038: refuses every mutually-exclusive mode combination before database access", () => {
    for (const modes of [
      ["--dry-run", "--skip-stripe"],
      ["--dry-run", "--flip"],
      ["--skip-stripe", "--flip"],
      ["--dry-run", "--skip-stripe", "--flip"],
    ]) {
      const result = runCli(["--tenant", tenantId, ...modes]);

      expect(result.status).toBe(1);
      expect(result.stderr).toContain(
        "--dry-run, --skip-stripe, and --flip are mutually exclusive",
      );
      expect(result.stderr).toContain("Usage: npm run upgrade:tenant-product");
      expect(result.stderr).not.toContain("Upgrade failed:");
    }
  });

  it("T039: refuses to run without an explicit mode", () => {
    const result = runCli(["--tenant", tenantId]);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Refusing to run without an explicit mode");
    expect(result.stderr).not.toContain("Upgrade failed:");
  });

  it("T040: refuses an invalid tenant UUID before database access", () => {
    const result = runCli(["--tenant", "not-a-uuid", "--dry-run"]);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Invalid tenant UUID: not-a-uuid");
    expect(result.stderr).not.toContain("Upgrade failed:");
  });

  it("T041: prints help without requiring tenant, mode, or database access", () => {
    const result = runCli(["--help"]);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("Upgrade an AlgaDesk tenant to AlgaPSA");
    expect(result.stdout).toContain("--tenant <uuid>");
    expect(result.stdout).toContain("--dry-run");
    expect(result.stdout).toContain("--skip-stripe");
    expect(result.stdout).toContain("--flip");
  });
});
