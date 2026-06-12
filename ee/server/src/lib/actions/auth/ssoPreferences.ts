"use server";

import { getTenantSettings, updateTenantSettings } from "@alga-psa/tenancy/actions/tenant-settings-actions/tenantSettingsActions";
import { withAuth, hasPermission } from "@alga-psa/auth";
import { TIER_FEATURES } from "@alga-psa/types";
import { createTenantKnex } from "@/lib/db";
import { listOAuthAccountLinksForUser } from "@ee/lib/auth/oauthAccountLinks";
import User from "@alga-psa/db/models/user";
import { auth } from "server/src/app/api/auth/[...nextauth]/auth";
import { assertTierAccess } from "server/src/lib/tier-gating/assertTierAccess";

export interface SsoPreferences {
  autoLinkInternal: boolean;
  autoLinkClient: boolean;
  clientPortalEntraProvisioningMode: "disabled" | "built_in" | "workflow_managed";
  clientPortalDefaultRoleName: string;
  deactivateEntraManagedPortalUsersOnEntitlementRemoval: boolean;
}

function normalizePreferences(raw?: any): SsoPreferences {
  const prefs = raw?.sso ?? {};
  const provisioningModeRaw = typeof prefs.clientPortalEntraProvisioningMode === "string"
    ? prefs.clientPortalEntraProvisioningMode
    : "disabled";
  const provisioningMode =
    provisioningModeRaw === "built_in" || provisioningModeRaw === "workflow_managed"
      ? provisioningModeRaw
      : "disabled";

  return {
    autoLinkInternal: Boolean(prefs.autoLinkInternal),
    autoLinkClient: Boolean(prefs.autoLinkClient),
    clientPortalEntraProvisioningMode: provisioningMode,
    clientPortalDefaultRoleName:
      typeof prefs.clientPortalDefaultRoleName === "string" &&
      prefs.clientPortalDefaultRoleName.trim().length > 0
        ? prefs.clientPortalDefaultRoleName.trim()
        : "User",
    deactivateEntraManagedPortalUsersOnEntitlementRemoval:
      prefs.deactivateEntraManagedPortalUsersOnEntitlementRemoval === undefined
        ? true
        : Boolean(prefs.deactivateEntraManagedPortalUsersOnEntitlementRemoval),
  };
}

export async function getSsoPreferencesAction(): Promise<SsoPreferences> {
  await assertTierAccess(TIER_FEATURES.SSO);
  const settings = await getTenantSettings();
  const rawSettings = typeof settings?.settings === "string" ? safeParse(settings.settings) : settings?.settings;
  return normalizePreferences(rawSettings);
}

function safeParse(raw: string): Record<string, unknown> | undefined {
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

async function assertClientPortalRoleExists(
  knex: Awaited<ReturnType<typeof createTenantKnex>>["knex"],
  tenant: string,
  roleName: string
): Promise<void> {
  const role = await knex("roles")
    .where({
      tenant,
      client: true,
    })
    .andWhereRaw("lower(role_name) = lower(?)", [roleName])
    .first(["role_id"]);

  if (!role?.role_id) {
    throw new Error("Selected default role must be an existing client portal role.");
  }
}

export const updateSsoPreferencesAction = withAuth(async (
  user,
  { tenant },
  updates: Partial<SsoPreferences>
): Promise<SsoPreferences> => {
  const { knex } = await createTenantKnex();
  const allowed = await hasPermission(user, "settings", "update", knex);
  if (!allowed) {
    throw new Error("You do not have permission to manage security settings.");
  }

  const tenantSettings = await getTenantSettings();
  const currentSettings =
    typeof tenantSettings?.settings === "string"
      ? safeParse(tenantSettings.settings) ?? {}
      : tenantSettings?.settings ?? {};

  const nextPreferences: SsoPreferences = {
    autoLinkInternal:
      updates.autoLinkInternal ?? Boolean(currentSettings?.sso?.autoLinkInternal),
    autoLinkClient: updates.autoLinkClient ?? Boolean(currentSettings?.sso?.autoLinkClient),
    clientPortalEntraProvisioningMode:
      updates.clientPortalEntraProvisioningMode ??
      normalizePreferences(currentSettings).clientPortalEntraProvisioningMode,
    clientPortalDefaultRoleName:
      (typeof updates.clientPortalDefaultRoleName === "string"
        ? updates.clientPortalDefaultRoleName.trim()
        : normalizePreferences(currentSettings).clientPortalDefaultRoleName) || "User",
    deactivateEntraManagedPortalUsersOnEntitlementRemoval:
      updates.deactivateEntraManagedPortalUsersOnEntitlementRemoval ??
      normalizePreferences(currentSettings).deactivateEntraManagedPortalUsersOnEntitlementRemoval,
  };

  if (updates.clientPortalDefaultRoleName !== undefined) {
    await assertClientPortalRoleExists(knex, tenant, nextPreferences.clientPortalDefaultRoleName);
  }

  const updatedSettings = {
    ...currentSettings,
    sso: {
      ...(currentSettings?.sso ?? {}),
      autoLinkInternal: nextPreferences.autoLinkInternal,
      autoLinkClient: nextPreferences.autoLinkClient,
      clientPortalEntraProvisioningMode: nextPreferences.clientPortalEntraProvisioningMode,
      clientPortalDefaultRoleName: nextPreferences.clientPortalDefaultRoleName,
      deactivateEntraManagedPortalUsersOnEntitlementRemoval:
        nextPreferences.deactivateEntraManagedPortalUsersOnEntitlementRemoval,
    },
  };

  await updateTenantSettings(updatedSettings);
  return nextPreferences;
});

export interface LinkedSsoAccount {
  provider: string;
  provider_account_id: string;
  provider_email: string | null;
  linked_at: string;
  last_used_at: string | null;
}

export interface GetLinkedSsoAccountsResult {
  success: boolean;
  accounts?: LinkedSsoAccount[];
  email?: string;
  twoFactorEnabled?: boolean;
  error?: string;
}

export async function getLinkedSsoAccountsAction(): Promise<GetLinkedSsoAccountsResult> {
  try {
    await assertTierAccess(TIER_FEATURES.SSO);

    const session = await auth();
    if (!session?.user?.email || !session.user.id) {
      return { success: false, error: "Authentication required" };
    }

    const email = session.user.email;
    const userRecord = await User.findUserByEmail(email.toLowerCase());
    if (!userRecord || !userRecord.user_id) {
      return { success: false, error: "User not found" };
    }

    const linkedAccountRecords = userRecord.tenant
      ? await listOAuthAccountLinksForUser(userRecord.tenant, userRecord.user_id.toString())
      : [];

    const accounts: LinkedSsoAccount[] = linkedAccountRecords.map((record) => ({
      provider: record.provider,
      provider_account_id: record.provider_account_id,
      provider_email: record.provider_email,
      linked_at: record.linked_at?.toISOString?.() ?? new Date(record.linked_at).toISOString(),
      last_used_at: record.last_used_at
        ? record.last_used_at instanceof Date
          ? record.last_used_at.toISOString()
          : new Date(record.last_used_at).toISOString()
        : null,
    }));

    return {
      success: true,
      accounts,
      email,
      twoFactorEnabled: Boolean(userRecord.two_factor_enabled),
    };
  } catch (error: any) {
    return {
      success: false,
      error: error?.message ?? "Failed to load linked accounts",
    };
  }
}
