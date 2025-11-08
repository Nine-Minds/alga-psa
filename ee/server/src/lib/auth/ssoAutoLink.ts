import { getAdminConnection } from "@shared/db/admin";

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
  if (!tenantId || userType !== "internal") {
    return false;
  }

  const knex = await getAdminConnection();
  const record = await knex("tenant_settings")
    .select("settings")
    .where({ tenant: tenantId })
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
