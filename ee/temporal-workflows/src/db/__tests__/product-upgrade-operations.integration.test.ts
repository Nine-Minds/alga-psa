import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import type { Knex } from "knex";
import { afterAll, describe, expect, it, vi } from "vitest";
import { tenantDb } from "@alga-psa/db";
import { destroyAdminConnection, getAdminConnection } from "@alga-psa/db/admin";
import {
  createTestTenant,
  createTestUser,
  rollbackTestTenant,
} from "./upgrade-test-fixtures.js";
import {
  runOnboardingSeeds,
  type SeedRunLog,
} from "../onboarding-seeds-operations.js";
import {
  applyRbacDelta,
  backfillClientTaxDefaults,
  backfillPsaSeeds,
  ensureSlaParity,
  flipProductCode,
  preflightProductUpgrade,
  runProductUpgrade,
  verifyProductUpgrade,
} from "../product-upgrade-operations.js";

vi.mock("@alga-psa/db/admin.js", async () => import("@alga-psa/db/admin"));

interface RoleGrantModule {
  ALL_MSP: string;
  psa: {
    msp: Record<string, readonly string[] | string>;
    client: Record<string, readonly string[] | string>;
  };
}

interface TenantFixture {
  db: Knex;
  tenantId: string;
  clientId: string;
  adminUserId: string;
}

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(currentDir, "../../../../..");
const grantsPath = path.join(
  repoRoot,
  "ee/server/seeds/onboarding/lib/roleGrants.cjs",
);
const roleGrants = createRequire(import.meta.url)(
  grantsPath,
) as RoleGrantModule;

const logEntries: Array<{
  level: "info" | "error";
  message: string;
  meta?: Record<string, unknown>;
}> = [];
const log: SeedRunLog = {
  info: (message, meta) => logEntries.push({ level: "info", message, meta }),
  error: (message, meta) => logEntries.push({ level: "error", message, meta }),
};

const seededTables = [
  "roles",
  "permissions",
  "role_permissions",
  "tax_regions",
  "tax_rates",
  "statuses",
  "project_templates",
  "project_template_status_mappings",
  "project_template_phases",
  "project_template_tasks",
  "project_template_checklist_items",
  "document_default_folders",
  "asset_type_registry",
  "workflow_definitions",
  "workflow_definition_versions",
  "tenant_workflow_schedule",
] as const;

const engineCleanupTables = [
  "sla_notification_thresholds",
  "sla_policy_targets",
  "boards",
  "priorities",
  "sla_policies",
  "client_tax_rates",
  "client_tax_settings",
  "tax_components",
  "tax_rates",
  "tax_regions",
  "tenant_workflow_schedule",
  "workflow_definition_versions",
  "workflow_definitions",
  "asset_type_registry",
  "document_default_folders",
  "project_template_checklist_items",
  "project_template_tasks",
  "project_template_phases",
  "project_template_status_mappings",
  "project_templates",
  "statuses",
] as const;

function permissionKey(row: {
  resource: string;
  action: string;
  msp: boolean;
}): string {
  return `${row.resource}:${row.action}:${row.msp ? "msp" : "client"}`;
}

async function createFixture(): Promise<TenantFixture> {
  const db = await getAdminConnection();
  const suffix = randomUUID();
  const tenant = await createTestTenant(db, {
    name: `Product Upgrade ${suffix}`,
    productCode: "algadesk",
  });

  return {
    db,
    tenantId: tenant.tenantId,
    clientId: tenant.clientId,
    adminUserId: "",
  };
}

async function cleanupFixture(fixture: TenantFixture): Promise<void> {
  const db = tenantDb(fixture.db, fixture.tenantId);
  for (const table of engineCleanupTables) {
    await db.table(table).where({ tenant: fixture.tenantId }).del();
  }
  await rollbackTestTenant(fixture.db, fixture.tenantId, log);
}

async function withFixture(
  run: (fixture: TenantFixture) => Promise<void>,
): Promise<void> {
  const fixture = await createFixture();
  try {
    await run(fixture);
  } finally {
    await cleanupFixture(fixture);
  }
}

async function seedAlgadesk(fixture: TenantFixture): Promise<void> {
  await runOnboardingSeeds(fixture.tenantId, "algadesk", { log });
  if (!fixture.adminUserId) {
    const admin = await createTestUser(fixture.db, {
      tenantId: fixture.tenantId,
      email: `admin-${randomUUID()}@example.test`,
      roleName: "Admin",
      msp: true,
    });
    fixture.adminUserId = admin.userId;
  }
}

async function countTenantRows(
  fixture: TenantFixture,
  tables: readonly string[],
): Promise<Record<string, number>> {
  const db = tenantDb(fixture.db, fixture.tenantId);
  const counts: Record<string, number> = {};
  for (const table of tables) {
    const row = await db
      .table(table)
      .where({ tenant: fixture.tenantId })
      .count<{ count: string }[]>({ count: "*" })
      .first();
    counts[table] = Number(row?.count ?? 0);
  }
  return counts;
}

async function getRole(
  fixture: TenantFixture,
  roleName: string,
  scope: "msp" | "client",
) {
  return tenantDb(fixture.db, fixture.tenantId)
    .table("roles")
    .where({
      tenant: fixture.tenantId,
      role_name: roleName,
      msp: scope === "msp",
      client: scope === "client",
    })
    .first();
}

async function rolePermissionKeys(
  fixture: TenantFixture,
  roleId: string,
): Promise<Set<string>> {
  const db = tenantDb(fixture.db, fixture.tenantId);
  const [permissions, assignments] = await Promise.all([
    db.table("permissions").where({ tenant: fixture.tenantId }),
    db
      .table("role_permissions")
      .where({ tenant: fixture.tenantId, role_id: roleId }),
  ]);
  const permissionById = new Map(
    permissions.map((permission) => [
      permission.permission_id,
      permissionKey(permission),
    ]),
  );
  return new Set(
    assignments
      .map((row) => permissionById.get(row.permission_id)!)
      .filter(Boolean),
  );
}

async function expectedGrantKeys(
  fixture: TenantFixture,
  grant: readonly string[] | string,
): Promise<Set<string>> {
  const permissions = await tenantDb(fixture.db, fixture.tenantId)
    .table("permissions")
    .where({ tenant: fixture.tenantId });
  const available = new Set(permissions.map(permissionKey));
  if (grant === roleGrants.ALL_MSP) {
    return new Set(
      permissions.filter((permission) => permission.msp).map(permissionKey),
    );
  }
  return new Set(grant.filter((key) => available.has(key)));
}

async function createInternalUserWithRoles(
  fixture: TenantFixture,
  label: string,
  roleIds: string[],
): Promise<string> {
  const created = await createTestUser(fixture.db, {
    tenantId: fixture.tenantId,
    email: `${label.toLowerCase()}-${randomUUID()}@example.test`,
    roleName: "Admin",
    msp: true,
  });
  const db = tenantDb(fixture.db, fixture.tenantId);
  await db
    .table("user_roles")
    .where({ tenant: fixture.tenantId, user_id: created.userId })
    .del();
  await db.table("user_roles").insert(
    roleIds.map((roleId) => ({
      tenant: fixture.tenantId,
      user_id: created.userId,
      role_id: roleId,
    })),
  );
  return created.userId;
}

async function copyItilPriorities(fixture: TenantFixture): Promise<number> {
  const standardRows = await tenantDb(
    fixture.db,
    "__product_upgrade_standard_priorities__",
  )
    .unscoped(
      "standard_priorities",
      "integration fixture reads global ITIL priority references",
    )
    .where({ is_itil_standard: true, item_type: "ticket" })
    .select(
      "priority_name",
      "color",
      "order_number",
      "item_type",
      "itil_priority_level",
    );
  await tenantDb(fixture.db, fixture.tenantId)
    .table("priorities")
    .insert(
      standardRows.map((row) => ({
        tenant: fixture.tenantId,
        priority_id: randomUUID(),
        created_by: fixture.adminUserId,
        is_from_itil_standard: true,
        ...row,
      })),
    );
  return standardRows.length;
}

async function stageTenant(fixture: TenantFixture) {
  await seedAlgadesk(fixture);
  return runProductUpgrade(fixture.tenantId, { skipStripe: true, log });
}

afterAll(async () => {
  await destroyAdminConnection();
});

describe.sequential("AlgaDesk to PSA product upgrade engine (real DB)", () => {
  it("T001: PSA seed 03 produces exactly the role grant-module permission set", async () => {
    await withFixture(async (fixture) => {
      await runOnboardingSeeds(fixture.tenantId, "psa", {
        include: (fileName) =>
          [
            "01_roles.cjs",
            "02_permissions.cjs",
            "03_role_permissions.cjs",
          ].includes(fileName),
        log,
      });
      const db = tenantDb(fixture.db, fixture.tenantId);
      const [roles, permissions, assignments] = await Promise.all([
        db.table("roles").where({ tenant: fixture.tenantId }),
        db.table("permissions").where({ tenant: fixture.tenantId }),
        db.table("role_permissions").where({ tenant: fixture.tenantId }),
      ]);
      const permissionById = new Map(
        permissions.map((permission) => [
          permission.permission_id,
          permissionKey(permission),
        ]),
      );
      const roleById = new Map(roles.map((role) => [role.role_id, role]));
      const actual = new Set(
        assignments.map((assignment) => {
          const role = roleById.get(assignment.role_id)!;
          const scope = role.msp ? "msp" : "client";
          return `${scope}/${role.role_name}/${permissionById.get(assignment.permission_id)}`;
        }),
      );
      const expected = new Set<string>();

      for (const role of roles) {
        const scope = role.msp ? "msp" : role.client ? "client" : null;
        if (!scope) continue;
        const grant = roleGrants.psa[scope][role.role_name];
        if (!grant) continue;
        const keys = await expectedGrantKeys(fixture, grant);
        for (const key of keys)
          expected.add(`${scope}/${role.role_name}/${key}`);
      }

      expect(actual).toEqual(expected);
    });
  });

  it("T003/T004/T005/T006/T007/T008/T009: PSA seed backfill creates every artifact, preserves RBAC, and is idempotent", async () => {
    await withFixture(async (fixture) => {
      await seedAlgadesk(fixture);
      const db = tenantDb(fixture.db, fixture.tenantId);
      const rolePermissionsBefore = await db
        .table("role_permissions")
        .where({ tenant: fixture.tenantId })
        .count<{ count: string }[]>({ count: "*" })
        .first();

      const firstSeeds = await backfillPsaSeeds(fixture.tenantId, log);
      const firstCounts = await countTenantRows(fixture, seededTables);

      expect(firstSeeds).toEqual([
        "01_roles.cjs",
        "02_permissions.cjs",
        "04_tax_regions.cjs",
        "05_tax_rates.cjs",
        "06_project_task_statuses.cjs",
        "07_ad_to_m365_project_template.cjs",
        "08_document_folder_templates.cjs",
        "09_asset_type_registry.cjs",
        "10_opportunity_workflows.cjs",
      ]);
      await expect(
        db
          .table("tax_regions")
          .where({ tenant: fixture.tenantId, region_code: "DEFAULT" })
          .first(),
      ).resolves.toMatchObject({
        region_name: "Default Tax Region",
        is_active: true,
      });
      const taxRate = await db
        .table("tax_rates")
        .where({ tenant: fixture.tenantId, description: "Non-taxable" })
        .first();
      expect(taxRate).toMatchObject({
        region_code: "DEFAULT",
        is_active: true,
      });
      expect(Number(taxRate.tax_percentage)).toBe(0);
      expect(
        new Set(
          await db
            .table("statuses")
            .where({ tenant: fixture.tenantId, status_type: "project_task" })
            .pluck("name"),
        ),
      ).toEqual(new Set(["To Do", "In Progress", "Blocked", "Done"]));
      await expect(
        db
          .table("project_templates")
          .where({
            tenant: fixture.tenantId,
            template_name: "Active Directory to Microsoft 365 Migration",
          })
          .first(),
      ).resolves.toBeTruthy();
      expect(
        new Set(
          await db
            .table("document_default_folders")
            .where({ tenant: fixture.tenantId })
            .pluck("entity_type"),
        ),
      ).toEqual(
        new Set([
          "client",
          "contact",
          "user",
          "team",
          "ticket",
          "project_task",
          "contract",
          "asset",
        ]),
      );
      expect(
        new Set(
          await db
            .table("asset_type_registry")
            .where({ tenant: fixture.tenantId })
            .pluck("slug"),
        ),
      ).toEqual(
        new Set([
          "workstation",
          "network_device",
          "server",
          "mobile_device",
          "printer",
          "unknown",
        ]),
      );
      expect(
        new Set(
          await db
            .table("workflow_definitions")
            .where({ tenant: fixture.tenantId })
            .pluck("key"),
        ),
      ).toEqual(
        new Set([
          "system.opportunity.stale-nudge",
          "system.opportunity.escalation",
          "system.opportunity.renewal-suggestions",
        ]),
      );
      expect(firstCounts.tenant_workflow_schedule).toBe(1);

      const rolePermissionsAfter = await db
        .table("role_permissions")
        .where({ tenant: fixture.tenantId })
        .count<{ count: string }[]>({ count: "*" })
        .first();
      expect(Number(rolePermissionsAfter?.count)).toBe(
        Number(rolePermissionsBefore?.count),
      );

      await backfillPsaSeeds(fixture.tenantId, log);
      expect(await countTenantRows(fixture, seededTables)).toEqual(firstCounts);
    });
  });

  it("T010/T011/T012/T013/T014/T015/T016/T017/T018: additive RBAC delta grants PSA roles without changing preserved roles or users", async () => {
    await withFixture(async (fixture) => {
      await seedAlgadesk(fixture);
      await backfillPsaSeeds(fixture.tenantId, log);
      const db = tenantDb(fixture.db, fixture.tenantId);
      const agentRole = await getRole(fixture, "Agent", "msp");
      const technicianRole = await getRole(fixture, "Technician", "msp");
      const adminRole = await getRole(fixture, "Admin", "msp");
      const portalAdmin = await getRole(fixture, "Admin", "client");
      const portalUser = await getRole(fixture, "User", "client");
      const agentUserId = await createInternalUserWithRoles(fixture, "Agent", [
        agentRole.role_id,
      ]);
      const existingTechnicianUserId = await createInternalUserWithRoles(
        fixture,
        "ExistingTechnician",
        [agentRole.role_id, technicianRole.role_id],
      );
      const customRoleId = randomUUID();
      const customPermission = await db
        .table("permissions")
        .where({
          tenant: fixture.tenantId,
          resource: "client",
          action: "read",
          msp: true,
        })
        .first();
      await db.table("roles").insert({
        tenant: fixture.tenantId,
        role_id: customRoleId,
        role_name: "Custom Operations",
        description: "Tenant-created role",
        msp: true,
        client: false,
      });
      await db.table("role_permissions").insert({
        tenant: fixture.tenantId,
        role_id: customRoleId,
        permission_id: customPermission.permission_id,
      });
      const agentBefore = await rolePermissionKeys(fixture, agentRole.role_id);
      const customBefore = await rolePermissionKeys(fixture, customRoleId);
      const portalAdminBefore = await rolePermissionKeys(
        fixture,
        portalAdmin.role_id,
      );
      const portalUserBefore = await rolePermissionKeys(
        fixture,
        portalUser.role_id,
      );

      await applyRbacDelta(fixture.tenantId, log);

      for (const [roleName, scope] of [
        ["Finance", "msp"],
        ["Technician", "msp"],
        ["Project Manager", "msp"],
        ["Dispatcher", "msp"],
        ["Finance", "client"],
      ] as const) {
        const role = await getRole(fixture, roleName, scope);
        expect(role).toBeTruthy();
        expect(await rolePermissionKeys(fixture, role.role_id)).toEqual(
          await expectedGrantKeys(fixture, roleGrants.psa[scope][roleName]),
        );
      }
      expect(await rolePermissionKeys(fixture, adminRole.role_id)).toEqual(
        await expectedGrantKeys(fixture, roleGrants.ALL_MSP),
      );
      expect(await rolePermissionKeys(fixture, agentRole.role_id)).toEqual(
        agentBefore,
      );
      expect(await rolePermissionKeys(fixture, customRoleId)).toEqual(
        customBefore,
      );

      const portalAdminAfter = await rolePermissionKeys(
        fixture,
        portalAdmin.role_id,
      );
      const portalUserAfter = await rolePermissionKeys(
        fixture,
        portalUser.role_id,
      );
      expect(portalAdminAfter).toEqual(
        new Set([
          ...portalAdminBefore,
          ...(await expectedGrantKeys(fixture, roleGrants.psa.client.Admin)),
        ]),
      );
      expect(portalUserAfter).toEqual(
        new Set([
          ...portalUserBefore,
          ...(await expectedGrantKeys(fixture, roleGrants.psa.client.User)),
        ]),
      );
      expect(portalAdminAfter.has("ticket:delete:client")).toBe(true);
      expect(portalAdminAfter.has("contact:read:client")).toBe(true);
      expect(portalAdminAfter.has("billing:read:client")).toBe(true);
      expect(portalAdminAfter.has("project:read:client")).toBe(true);
      expect(portalAdminAfter.has("time_management:read:client")).toBe(true);

      const agentAssignments = await db
        .table("user_roles")
        .where({ tenant: fixture.tenantId, user_id: agentUserId })
        .pluck("role_id");
      expect(new Set(agentAssignments)).toEqual(
        new Set([agentRole.role_id, technicianRole.role_id]),
      );
      expect(
        await db.table("user_roles").where({
          tenant: fixture.tenantId,
          user_id: existingTechnicianUserId,
          role_id: technicianRole.role_id,
        }),
      ).toHaveLength(1);
      expect(
        await db
          .table("user_roles")
          .where({
            tenant: fixture.tenantId,
            user_id: fixture.adminUserId,
          })
          .pluck("role_id"),
      ).toEqual([adminRole.role_id]);

      const countsBeforeRerun = await countTenantRows(fixture, [
        "role_permissions",
        "user_roles",
      ]);
      await applyRbacDelta(fixture.tenantId, log);
      expect(
        await countTenantRows(fixture, ["role_permissions", "user_roles"]),
      ).toEqual(countsBeforeRerun);
    });
  });

  it("T019/T020/T021/T022: client tax and ITIL SLA parity backfills are additive and idempotent", async () => {
    await withFixture(async (fixture) => {
      await seedAlgadesk(fixture);
      await backfillPsaSeeds(fixture.tenantId, log);
      const db = tenantDb(fixture.db, fixture.tenantId);
      const configuredClientId = randomUUID();
      await db.table("clients").insert({
        tenant: fixture.tenantId,
        client_id: configuredClientId,
        client_name: "Configured Client",
      });
      await db.table("client_tax_settings").insert({
        tenant: fixture.tenantId,
        client_id: configuredClientId,
        is_reverse_charge_applicable: true,
      });
      const configuredBefore = await db
        .table("client_tax_settings")
        .where({ tenant: fixture.tenantId, client_id: configuredClientId })
        .first();

      const taxResult = await backfillClientTaxDefaults(fixture.tenantId, log);
      expect(taxResult).toMatchObject({
        clientsChecked: 2,
        settingsCreated: 1,
        associationsCreated: 2,
      });
      const createdSettings = await db
        .table("client_tax_settings")
        .where({ tenant: fixture.tenantId, client_id: fixture.clientId })
        .first();
      expect(createdSettings).toMatchObject({
        is_reverse_charge_applicable: false,
      });
      const createdAssociation = await db
        .table("client_tax_rates")
        .where({
          tenant: fixture.tenantId,
          client_id: fixture.clientId,
          is_default: true,
        })
        .whereNull("location_id")
        .first();
      const seededRate = await db
        .table("tax_rates")
        .where({
          tenant: fixture.tenantId,
          description: "Non-taxable",
          region_code: "DEFAULT",
        })
        .first();
      expect(createdAssociation).toMatchObject({
        tax_rate_id: seededRate.tax_rate_id,
      });
      expect(
        await db
          .table("client_tax_settings")
          .where({ tenant: fixture.tenantId, client_id: configuredClientId })
          .first(),
      ).toEqual(configuredBefore);

      const priorityCount = await copyItilPriorities(fixture);
      expect(priorityCount).toBe(5);
      const manualPolicyId = randomUUID();
      const missingBoardId = randomUUID();
      const manualBoardId = randomUUID();
      await db.table("sla_policies").insert({
        tenant: fixture.tenantId,
        sla_policy_id: manualPolicyId,
        policy_name: "Customer Managed SLA",
        is_default: false,
      });
      await db.table("boards").insert([
        {
          tenant: fixture.tenantId,
          board_id: missingBoardId,
          board_name: "ITIL Missing SLA",
          category_type: "itil",
          priority_type: "itil",
          display_order: 1,
        },
        {
          tenant: fixture.tenantId,
          board_id: manualBoardId,
          board_name: "ITIL Manual SLA",
          category_type: "itil",
          priority_type: "itil",
          display_order: 2,
          sla_policy_id: manualPolicyId,
        },
      ]);

      const dryRun = await runProductUpgrade(fixture.tenantId, {
        dryRun: true,
        log,
      });
      expect(dryRun.mode).toBe("dry-run");
      if (dryRun.mode === "dry-run")
        expect(dryRun.itilBoardsMissingSla).toBe(1);

      const first = await ensureSlaParity(fixture.tenantId, log);
      expect(first).toEqual({
        boardsChecked: 2,
        policyCreated: 1,
        thresholdsCreated: 4,
        targetsCreated: priorityCount,
        boardsAssigned: 1,
      });
      const itilPolicy = await db
        .table("sla_policies")
        .where({ tenant: fixture.tenantId, policy_name: "ITIL Standard" })
        .first();
      const thresholds = await db.table("sla_notification_thresholds").where({
        tenant: fixture.tenantId,
        sla_policy_id: itilPolicy.sla_policy_id,
      });
      expect(new Set(thresholds.map((row) => row.threshold_percent))).toEqual(
        new Set([50, 75, 90, 100]),
      );
      const targets = await db.table("sla_policy_targets").where({
        tenant: fixture.tenantId,
        sla_policy_id: itilPolicy.sla_policy_id,
      });
      expect(targets).toHaveLength(priorityCount);
      expect(
        new Set(
          targets.map(
            (row) =>
              `${row.response_time_minutes}/${row.resolution_time_minutes}`,
          ),
        ),
      ).toEqual(
        new Set(["15/60", "30/240", "60/1440", "240/4320", "480/10080"]),
      );
      await expect(
        db
          .table("boards")
          .where({ tenant: fixture.tenantId, board_id: missingBoardId })
          .first(),
      ).resolves.toMatchObject({ sla_policy_id: itilPolicy.sla_policy_id });
      await expect(
        db
          .table("boards")
          .where({ tenant: fixture.tenantId, board_id: manualBoardId })
          .first(),
      ).resolves.toMatchObject({ sla_policy_id: manualPolicyId });
      expect(await ensureSlaParity(fixture.tenantId, log)).toEqual({
        boardsChecked: 2,
        policyCreated: 0,
        thresholdsCreated: 0,
        targetsCreated: 0,
        boardsAssigned: 0,
      });
    });
  });

  it("T023: preflight rejects a PSA tenant without writes", async () => {
    await withFixture(async (fixture) => {
      const db = tenantDb(fixture.db, fixture.tenantId);
      await db
        .table("tenants")
        .where({ tenant: fixture.tenantId })
        .update({ product_code: "psa" });
      const before = await countTenantRows(fixture, [
        "tenants",
        "clients",
        "users",
        "roles",
        "user_roles",
      ]);

      await expect(
        preflightProductUpgrade(fixture.tenantId, log),
      ).rejects.toThrow('expected product_code "algadesk", found "psa"');
      expect(
        await countTenantRows(fixture, [
          "tenants",
          "clients",
          "users",
          "roles",
          "user_roles",
        ]),
      ).toEqual(before);
    });
  });

  it("T024: guarded product flip updates one row and refuses a re-flip", async () => {
    await withFixture(async (fixture) => {
      const db = tenantDb(fixture.db, fixture.tenantId);
      await expect(
        flipProductCode(fixture.tenantId, log),
      ).resolves.toBeUndefined();
      await expect(
        db
          .table("tenants")
          .where({ tenant: fixture.tenantId })
          .first("product_code"),
      ).resolves.toMatchObject({ product_code: "psa" });
      await expect(flipProductCode(fixture.tenantId, log)).rejects.toThrow(
        "expected 1 algadesk tenant row, updated 0",
      );
    });
  });

  it("T025: verification collects and reports a missing active tax rate", async () => {
    await withFixture(async (fixture) => {
      await stageTenant(fixture);
      await flipProductCode(fixture.tenantId, log);
      await tenantDb(fixture.db, fixture.tenantId)
        .table("tax_rates")
        .where({ tenant: fixture.tenantId })
        .update({ is_active: false });
      await tenantDb(fixture.db, fixture.tenantId)
        .table("client_tax_settings")
        .where({ tenant: fixture.tenantId, client_id: fixture.clientId })
        .del();

      const verificationError = await verifyProductUpgrade(
        fixture.tenantId,
        log,
      ).then(
        () => null,
        (error) => error as Error,
      );
      expect(verificationError).toBeInstanceOf(Error);
      expect(verificationError?.message).toContain(
        "no active tenant tax rate exists",
      );
      expect(verificationError?.message).toContain(
        "1 clients are missing client_tax_settings rows",
      );
      expect(logEntries.at(-1)).toMatchObject({ level: "error" });
    });
  });

  it("T026: verification fails when an Agent user lacks Technician", async () => {
    await withFixture(async (fixture) => {
      await seedAlgadesk(fixture);
      const agentRole = await getRole(fixture, "Agent", "msp");
      const agentUserId = await createInternalUserWithRoles(
        fixture,
        "VerifyAgent",
        [agentRole.role_id],
      );
      await runProductUpgrade(fixture.tenantId, { skipStripe: true, log });
      await flipProductCode(fixture.tenantId, log);
      const technicianRole = await getRole(fixture, "Technician", "msp");
      await tenantDb(fixture.db, fixture.tenantId)
        .table("user_roles")
        .where({
          tenant: fixture.tenantId,
          user_id: agentUserId,
          role_id: technicianRole.role_id,
        })
        .del();

      await expect(verifyProductUpgrade(fixture.tenantId, log)).rejects.toThrow(
        "1 Agent users do not also hold Technician",
      );
    });
  });

  it("T027: the runner withholds the flip when the preceding Stripe step throws", async () => {
    await withFixture(async (fixture) => {
      await seedAlgadesk(fixture);

      await expect(
        runProductUpgrade(fixture.tenantId, { log }),
      ).rejects.toThrow("Stripe product swap is not implemented");
      await expect(
        tenantDb(fixture.db, fixture.tenantId)
          .table("tenants")
          .where({ tenant: fixture.tenantId })
          .first("product_code"),
      ).resolves.toMatchObject({ product_code: "algadesk" });
    });
  });

  it("T041: programmatic staged and flip-only CLI phases complete with verification green", async () => {
    await withFixture(async (fixture) => {
      await seedAlgadesk(fixture);
      logEntries.length = 0;

      const staged = await runProductUpgrade(fixture.tenantId, {
        skipStripe: true,
        log,
      });
      expect(staged).toMatchObject({ mode: "staged", flipWithheld: true });
      await expect(
        tenantDb(fixture.db, fixture.tenantId)
          .table("tenants")
          .where({ tenant: fixture.tenantId })
          .first("product_code"),
      ).resolves.toMatchObject({ product_code: "algadesk" });

      const completed = await runProductUpgrade(fixture.tenantId, {
        flipOnly: true,
        log,
      });
      expect(completed).toMatchObject({
        mode: "complete",
        completedSteps: ["preflight", "flip", "verify"],
        flipWithheld: false,
      });
      expect(
        logEntries.some(
          (entry) => entry.message === "Product upgrade verification passed",
        ),
      ).toBe(true);
    });
  });
});
