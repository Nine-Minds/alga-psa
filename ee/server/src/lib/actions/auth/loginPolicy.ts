"use server";

import { getTenantSettings, updateTenantSettings } from "@alga-psa/tenancy/actions/tenant-settings-actions/tenantSettingsActions";
import { getSsoProviderOptions } from "@ee/lib/auth/providerConfig";
import { ensureSsoSettingsPermission } from "@ee/lib/actions/auth/ssoPermissions";
import {
  applyPolicyChange,
  normalizeTenantAuthPolicy,
  validatePolicyChange,
  type PolicyGuardErrorCode,
  type TenantAuthPolicy,
} from "@alga-psa/auth/lib/authPolicy";
import {
  invalidateTenantAuthPolicyCache,
  listBreakGlassCandidates,
  loadTenantAuthPolicy,
  recordPolicyChange,
} from "@alga-psa/auth/lib/authPolicyStore";

/**
 * Tenant login policy (SSO-required, 2FA, break-glass). The server is the
 * authority: every save revalidates the whole policy via `validatePolicyChange`
 * and the UI only mirrors the result. Decisions live in packages/auth/authPolicy.ts.
 */

export interface LoginPolicyState {
  policy: TenantAuthPolicy;
  /** Internal admins with 2FA enrolled and active: the only users who may be break-glass. */
  eligibleBreakGlassAdmins: Array<{ userId: string; name: string; email: string }>;
  hasConfiguredSsoProvider: boolean;
}

export type LoginPolicyUpdate = Partial<Omit<TenantAuthPolicy, "passwordAuthDisabledAt">>;

export interface UpdateLoginPolicyResult {
  success: boolean;
  errors?: PolicyGuardErrorCode[];
  invalidBreakGlassUserIds?: string[];
  state?: LoginPolicyState;
}

function safeParse(raw: string): Record<string, unknown> | undefined {
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

async function hasConfiguredProvider(tenant: string): Promise<boolean> {
  // Same resolver the sign-in path uses, so "configured" here means "can actually sign in".
  const options = await getSsoProviderOptions(tenant);
  return options.some((option) => option.configured);
}

async function listEligibleAdmins(
  knex: Awaited<ReturnType<typeof ensureSsoSettingsPermission>>["knex"],
  tenant: string
): Promise<LoginPolicyState["eligibleBreakGlassAdmins"]> {
  const candidates = await listBreakGlassCandidates(tenant);
  const eligibleIds = candidates
    .filter((c) => c.isAdmin && c.twoFactorEnabled && !c.isInactive)
    .map((c) => c.userId);
  if (eligibleIds.length === 0) return [];
  const rows = await knex("users")
    .where({ tenant, user_type: "internal" })
    .whereIn("user_id", eligibleIds)
    .select("user_id", "first_name", "last_name", "email");
  return rows.map((row: any) => ({
    userId: row.user_id,
    name: `${row.first_name ?? ""} ${row.last_name ?? ""}`.trim() || row.email,
    email: row.email,
  }));
}

export async function getLoginPolicyAction(): Promise<LoginPolicyState> {
  const { tenant, knex } = await ensureSsoSettingsPermission();
  const [policy, eligibleBreakGlassAdmins, hasConfiguredSsoProvider] = await Promise.all([
    loadTenantAuthPolicy(tenant, { bypassCache: true }),
    listEligibleAdmins(knex, tenant),
    hasConfiguredProvider(tenant),
  ]);
  return { policy, eligibleBreakGlassAdmins, hasConfiguredSsoProvider };
}

export async function updateLoginPolicyAction(
  updates: LoginPolicyUpdate
): Promise<UpdateLoginPolicyResult> {
  const { user, tenant, knex } = await ensureSsoSettingsPermission();

  const tenantSettings = await getTenantSettings();
  const currentSettings: Record<string, any> =
    (typeof tenantSettings?.settings === "string"
      ? safeParse(tenantSettings.settings)
      : tenantSettings?.settings) ?? {};

  const previous = normalizeTenantAuthPolicy(currentSettings);
  const next = applyPolicyChange(previous, updates);

  const [hasConfiguredSsoProvider, breakGlassCandidates] = await Promise.all([
    next.requireSsoForInternalUsers ? hasConfiguredProvider(tenant) : Promise.resolve(true),
    listBreakGlassCandidates(tenant, next.passwordBreakGlassUserIds),
  ]);

  const guard = validatePolicyChange({ next, hasConfiguredSsoProvider, breakGlassCandidates });
  if (!guard.ok) {
    return {
      success: false,
      errors: guard.errors,
      invalidBreakGlassUserIds: guard.invalidBreakGlassUserIds,
    };
  }

  await updateTenantSettings({
    ...currentSettings,
    sso: {
      ...(currentSettings.sso ?? {}),
      requireSsoForInternalUsers: next.requireSsoForInternalUsers,
      require2faForInternalUsers: next.require2faForInternalUsers,
      require2faForClientUsers: next.require2faForClientUsers,
      allowKnownDevice2faSkip: next.allowKnownDevice2faSkip,
      passwordBreakGlassUserIds: next.passwordBreakGlassUserIds,
      passwordAuthDisabledAt: next.passwordAuthDisabledAt,
    },
  });
  invalidateTenantAuthPolicyCache(tenant);
  await recordPolicyChange({
    tenant,
    actorUserId: String(user.user_id),
    before: previous,
    after: next,
  });

  return {
    success: true,
    state: {
      policy: next,
      eligibleBreakGlassAdmins: await listEligibleAdmins(knex, tenant),
      hasConfiguredSsoProvider,
    },
  };
}
