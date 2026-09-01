/**
 * The onboarding permission seeds require the catalog at runtime. In this image
 * the seed tree is copied to dist/seeds/onboarding and the catalog to
 * dist/seeds/permissions, so a source-tree-relative require would resolve in a
 * developer checkout and fail in production. This pins both halves: the
 * Dockerfile ships the catalog wherever it ships the seeds, and the resolver
 * loads it from the packaged layout.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(currentDir, "../../../../..");
const dockerfile = fs.readFileSync(
  path.join(repoRoot, "ee/temporal-workflows/Dockerfile"),
  "utf8",
);

// realpathSync: macOS /var is a symlink to /private/var, and __dirname inside
// the copied resolver is already resolved.
const packagedRoot = fs.realpathSync(
  fs.mkdtempSync(path.join(os.tmpdir(), "alga-catalog-pkg-")),
);

afterAll(() => {
  fs.rmSync(packagedRoot, { recursive: true, force: true });
});

describe("packaged permission catalog", () => {
  it("ships the catalog in every stage that ships the onboarding seeds", () => {
    const seedCopies = dockerfile.match(
      /^COPY ee\/server\/seeds\/onboarding .*dist\/seeds\/onboarding$/gm,
    ) ?? [];
    const catalogCopies = dockerfile.match(
      /^COPY server\/migrations\/utils\/permissions .*dist\/seeds\/permissions$/gm,
    ) ?? [];
    const tenantDbCopies = dockerfile.match(
      /^COPY server\/migrations\/utils\/tenantDb\.cjs .*dist\/seeds\/tenantDb\.cjs$/gm,
    ) ?? [];

    expect(seedCopies.length).toBeGreaterThan(0);
    expect(catalogCopies).toHaveLength(seedCopies.length);
    expect(tenantDbCopies).toHaveLength(seedCopies.length);
  });

  it("loads from the packaged layout, without the source checkout", () => {
    // Mirror dist/seeds: onboarding/lib + permissions + tenantDb.cjs, and
    // nothing above it, so the source-tree candidate cannot resolve.
    const seeds = path.join(packagedRoot, "dist", "seeds");
    fs.mkdirSync(path.join(seeds, "onboarding", "lib"), { recursive: true });
    fs.cpSync(
      path.join(repoRoot, "server/migrations/utils/permissions"),
      path.join(seeds, "permissions"),
      { recursive: true },
    );
    fs.copyFileSync(
      path.join(repoRoot, "server/migrations/utils/tenantDb.cjs"),
      path.join(seeds, "tenantDb.cjs"),
    );
    const resolver = path.join(seeds, "onboarding", "lib", "permissionCatalog.cjs");
    fs.copyFileSync(
      path.join(repoRoot, "ee/server/seeds/onboarding/lib/permissionCatalog.cjs"),
      resolver,
    );

    const loaded = createRequire(resolver)(resolver);

    expect(loaded.catalogRoot).toBe(path.join(seeds, "permissions"));
    expect(loaded.catalog.ACTIVE_PERMISSIONS.length).toBeGreaterThan(0);
    expect(typeof loaded.syncPermissionCatalog).toBe("function");
    expect(typeof loaded.applyDefaultRoleGrants).toBe("function");
    expect(typeof loaded.listTenantsForProduct).toBe("function");
    expect(typeof loaded.reconcileAllTenants).toBe("function");
    expect(typeof loaded.roleGrants.compileLegacyRoleGrants).toBe("function");
  });

  it("loads from the source checkout too", () => {
    const loaded = createRequire(import.meta.url)(
      path.join(repoRoot, "ee/server/seeds/onboarding/lib/permissionCatalog.cjs"),
    );

    expect(loaded.catalogRoot).toBe(
      path.join(repoRoot, "server/migrations/utils/permissions"),
    );
    expect(loaded.catalog.catalogVersion()).toMatch(/^v1-[0-9a-f]{16}$/);
  });
});
