import { createRequire } from "node:module";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

interface RoleGrantModule {
  ALL_MSP: string;
  psa: {
    msp: Record<string, readonly string[] | string>;
    client: Record<string, readonly string[] | string>;
  };
  algadesk: {
    msp: Record<string, readonly string[] | string>;
    client: Record<string, readonly string[] | string>;
  };
}

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(currentDir, "../../../../..");
const require = createRequire(import.meta.url);

// Paths stay in variables: an inline workspace-path literal inside require()
// is resolved by nx's static analyzer into a project edge, which would make
// this test file close a temporal-workflows <-> sebastian-ee cycle.
const grantsPath = path.join(
  repoRoot,
  "ee/server/seeds/onboarding/lib/roleGrants.cjs",
);
const catalogGrantsPath = path.join(
  repoRoot,
  "server/migrations/utils/permissions/roleGrants.cjs",
);
const catalogPath = path.join(
  repoRoot,
  "server/migrations/utils/permissions/catalog.cjs",
);

// product-upgrade-operations loads this exact path out of its packaged seed
// tree, so the shape it re-exports is a contract.
const roleGrants = require(grantsPath) as RoleGrantModule;

const catalogRoleGrants = require(catalogGrantsPath);
const catalog = require(catalogPath);

describe("PSA role grant extraction contract", () => {
  it("T002: re-exports the unified catalog's default-role grants with the ALL_MSP sentinel", () => {
    expect(roleGrants.ALL_MSP).toBe("ALL_MSP");
    expect(roleGrants.psa.msp.Admin).toBe(roleGrants.ALL_MSP);
    expect(roleGrants.algadesk.msp.Admin).toBe(roleGrants.ALL_MSP);

    expect(roleGrants.psa).toEqual(catalogRoleGrants.compileLegacyRoleGrants("psa"));
    expect(roleGrants.algadesk).toEqual(catalogRoleGrants.compileLegacyRoleGrants("algadesk"));

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
  });

  it("resolves every non-Admin grant key against the catalog's PSA permissions", () => {
    const psaKeys = new Set<string>(
      catalog
        .getProductPermissions("psa")
        .flatMap((entry: any) => catalog.permissionGrantKeys(entry)),
    );

    for (const scope of ["msp", "client"] as const) {
      for (const [roleName, grant] of Object.entries(roleGrants.psa[scope])) {
        if (grant === roleGrants.ALL_MSP) continue;
        for (const key of grant as readonly string[]) {
          expect(psaKeys.has(key), `${scope}:${roleName} -> ${key}`).toBe(true);
        }
      }
    }
  });

  it("no longer grants the retired credit:reconcile permission", () => {
    const everyKey = [
      ...Object.values(roleGrants.psa.msp),
      ...Object.values(roleGrants.psa.client),
    ].flatMap((grant) => (Array.isArray(grant) ? grant : []));

    expect(everyKey).not.toContain("credit:reconcile:msp");
  });
});
