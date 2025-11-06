"use server";

import { getTenantSettings, updateTenantSettings } from "server/src/lib/actions/tenant-settings-actions/tenantSettingsActions";
import { getCurrentUser } from "@/lib/actions/user-actions/userActions";
import { hasPermission } from "@/lib/auth/rbac";
import { createTenantKnex } from "@/lib/db";

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
