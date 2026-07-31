import { getAdminConnection } from "@alga-psa/db/admin";
import { tenantDb } from "@alga-psa/db";

function parseSettings(raw: any): any {
  if (!raw) return undefined;
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw);
    } catch {
      return undefined;
    }
  }
  return raw;
}

export async function isAutoLinkEnabledForTenant(
  tenantId: string | undefined,
  userType: "internal" | "client"
): Promise<boolean> {
  if (!tenantId) {
    return false;
  }

  const knex = await getAdminConnection();
  const record = await tenantDb(knex, tenantId).table("tenant_settings")
    .select("settings")
    .first();

  if (!record) {
    return false;
  }

  const settings = parseSettings(record.settings);
  const prefs = settings?.sso ?? {};

  if (userType === "client") {
    return Boolean(prefs.autoLinkClient);
  }

  return Boolean(prefs.autoLinkInternal);
}
