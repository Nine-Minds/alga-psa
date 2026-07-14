import { tenantDb } from "@alga-psa/db";
import type { Knex } from "knex";
import type { SeedRunLog } from "../onboarding-seeds-operations.js";
import { rollbackTenantInDB } from "../tenant-operations.js";

export async function createTestTenant(
  knex: Knex,
  input: { name: string; productCode: "psa" | "algadesk" },
): Promise<{ tenantId: string; clientId: string }> {
  return knex.transaction(async (trx) => {
    const now = new Date();
    const slug = input.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
    const [tenantRow] = await tenantDb(trx, "__test_bootstrap__")
      .unscoped(
        "tenants",
        "product upgrade test fixture inserts tenant before tenant scope exists",
      )
      .insert({
        client_name: input.name,
        email: `${slug}@test.local`,
        product_code: input.productCode,
        created_at: now,
        updated_at: now,
      })
      .returning("tenant");
    const tenantId = tenantRow.tenant ?? tenantRow;
    const [clientRow] = await tenantDb(trx, tenantId)
      .table("clients")
      .insert({
        tenant: tenantId,
        client_name: input.name,
        created_at: now,
        updated_at: now,
      })
      .returning("client_id");

    return {
      tenantId,
      clientId: clientRow.client_id ?? clientRow,
    };
  });
}

export async function createTestUser(
  knex: Knex,
  input: {
    tenantId: string;
    email: string;
    roleName: string;
    msp: boolean;
  },
): Promise<{ userId: string; roleId: string }> {
  return knex.transaction(async (trx) => {
    const db = tenantDb(trx, input.tenantId);
    const role = await db
      .table("roles")
      .where({
        tenant: input.tenantId,
        role_name: input.roleName,
        msp: input.msp,
        client: !input.msp,
      })
      .first();
    if (!role) {
      throw new Error(
        `Role ${input.roleName} (${input.msp ? "msp" : "client"}) not found for tenant ${input.tenantId}`,
      );
    }

    const now = new Date();
    const normalizedEmail = input.email.toLowerCase();
    const [userRow] = await db
      .table("users")
      .insert({
        tenant: input.tenantId,
        email: normalizedEmail,
        user_type: "internal",
        username: normalizedEmail,
        hashed_password: "test-fixture:not-a-real-hash",
        is_inactive: false,
        two_factor_enabled: false,
        is_google_user: false,
        created_at: now,
        updated_at: now,
      })
      .returning("user_id");
    const userId = userRow.user_id ?? userRow;

    await db.table("user_roles").insert({
      tenant: input.tenantId,
      user_id: userId,
      role_id: role.role_id,
      created_at: now,
    });

    return { userId, roleId: role.role_id };
  });
}

export async function rollbackTestTenant(
  knex: Knex,
  tenantId: string,
  log: SeedRunLog,
): Promise<void> {
  void knex;
  await rollbackTenantInDB(tenantId, { log });
}
