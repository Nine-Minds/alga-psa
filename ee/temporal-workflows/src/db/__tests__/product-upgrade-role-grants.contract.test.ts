import { createRequire } from "node:module";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

interface RoleGrantModule {
  ALL_MSP: string;
  psa: {
    msp: Record<string, readonly string[] | string>;
    client: Record<string, readonly string[] | string>;
  };
}

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(currentDir, "../../../../..");
const grantsPath = path.join(
  repoRoot,
  "ee/server/seeds/onboarding/lib/roleGrants.cjs",
);
const seedPath = path.join(
  repoRoot,
  "ee/server/seeds/onboarding/psa/03_role_permissions.cjs",
);
const roleGrants = createRequire(import.meta.url)(
  grantsPath,
) as RoleGrantModule;

describe("PSA role grant extraction contract", () => {
  it("T002: exports every PSA seed dispatch grant with pinned list lengths and ALL_MSP sentinel", () => {
    const seedSource = fs.readFileSync(seedPath, "utf8");

    expect(seedSource).toContain(
      "const { ALL_MSP, psa: roleGrants } = require('../lib/roleGrants.cjs')",
    );
    expect(seedSource).toContain("grants = roleGrants.msp[role.role_name]");
    expect(seedSource).toContain("grants = roleGrants.client[role.role_name]");
    expect(seedSource).toContain("if (grants === ALL_MSP)");

    expect(roleGrants.ALL_MSP).toBe("ALL_MSP");
    expect(roleGrants.psa.msp.Admin).toBe(roleGrants.ALL_MSP);
    expect(Object.keys(roleGrants.psa.msp)).toEqual([
      "Admin",
      "Finance",
      "Manager",
      "Technician",
      "Project Manager",
      "Dispatcher",
    ]);
    expect(Object.keys(roleGrants.psa.client)).toEqual([
      "Admin",
      "Finance",
      "User",
    ]);

    expect([
      (roleGrants.psa.msp.Finance as readonly string[]).length,
      (roleGrants.psa.msp.Manager as readonly string[]).length,
      (roleGrants.psa.msp.Technician as readonly string[]).length,
      (roleGrants.psa.msp["Project Manager"] as readonly string[]).length,
      (roleGrants.psa.msp.Dispatcher as readonly string[]).length,
      (roleGrants.psa.client.Admin as readonly string[]).length,
      (roleGrants.psa.client.Finance as readonly string[]).length,
      (roleGrants.psa.client.User as readonly string[]).length,
    ]).toEqual([66, 40, 37, 49, 27, 30, 14, 11]);
  });
});
