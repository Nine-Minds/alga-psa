"use server";

import { getTenantSettings, updateTenantSettings } from "server/src/lib/actions/tenant-settings-actions/tenantSettingsActions";
import { getCurrentUser } from "@alga-psa/users/actions";
import { hasPermission } from "@alga-psa/auth";
import { createTenantKnex } from "@/lib/db";
import { listOAuthAccountLinksForUser } from "@ee/lib/auth/oauthAccountLinks";
import User from "server/src/lib/models/user";
import { auth } from "server/src/app/api/auth/[...nextauth]/auth";

export interface SsoPreferences {
  autoLinkInternal: boolean;
  autoLinkClient: boolean;
}

function normalizePreferences(raw?: any): SsoPreferences {
  const prefs = raw?.sso ?? {};
  return {
    autoLinkInternal: Boolean(prefs.autoLinkInternal),
    autoLinkClient: Boolean(prefs.autoLinkClient),
  };
}

export async function getSsoPreferencesAction(): Promise<SsoPreferences> {
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

async function ensureSettingsPermission(): Promise<void> {
  const user = await getCurrentUser();
  if (!user) {
    throw new Error("Authentication required");
  }

  const { knex } = await createTenantKnex();
  const allowed = await hasPermission(user, "settings", "update", knex);
  if (!allowed) {
    throw new Error("You do not have permission to manage security settings.");
  }
}

export async function updateSsoPreferencesAction(
  updates: Partial<SsoPreferences>
): Promise<SsoPreferences> {
  await ensureSettingsPermission();

  const tenantSettings = await getTenantSettings();
  const currentSettings =
    typeof tenantSettings?.settings === "string"
      ? safeParse(tenantSettings.settings) ?? {}
      : tenantSettings?.settings ?? {};

  const nextPreferences: SsoPreferences = {
    autoLinkInternal:
      updates.autoLinkInternal ?? Boolean(currentSettings?.sso?.autoLinkInternal),
    autoLinkClient: updates.autoLinkClient ?? Boolean(currentSettings?.sso?.autoLinkClient),
  };

  const updatedSettings = {
    ...currentSettings,
    sso: {
      ...(currentSettings?.sso ?? {}),
      autoLinkInternal: nextPreferences.autoLinkInternal,
      autoLinkClient: nextPreferences.autoLinkClient,
    },
  };

  await updateTenantSettings(updatedSettings);
  return nextPreferences;
}

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
