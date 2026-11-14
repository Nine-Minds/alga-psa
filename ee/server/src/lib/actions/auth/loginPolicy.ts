"use server";

import logger from "@alga-psa/core/logger";
import { getTenantSettings } from "@alga-psa/tenancy/actions/tenant-settings-actions/tenantSettingsActions";
import { getSsoProviderOptions } from "@ee/lib/auth/providerConfig";
import { ensureSsoSettingsPermission } from "@ee/lib/actions/auth/ssoPermissions";
import {
  applyPolicyChange,
  isValidBreakGlassCandidate,
  normalizeTenantAuthPolicy,
  validatePolicyChange,
  type PolicyGuardErrorCode,
  type TenantAuthPolicy,
} from "@alga-psa/auth/lib/authPolicy";
import {
  listBreakGlassCandidates,
  loadTenantAuthPolicy,
  saveTenantAuthPolicy,
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
  /**
   * Stored break-glass ids that are no longer eligible (2FA reset, deactivated,
   * demoted or deleted). `name`/`email` are set when the user still exists.
   */
  ineligibleBreakGlassUsers: Array<{
    userId: string;
    name?: string;
    email?: string;
    reason?: "inactive" | "not_admin" | "no_two_factor" | "not_internal" | "not_found";
  }>;
  hasConfiguredSsoProvider: boolean;
}

export type LoginPolicyUpdate = Partial<Omit<TenantAuthPolicy, "passwordAuthDisabledAt">>;

export interface UpdateLoginPolicyResult {
  success: boolean;
  /** Guard codes, or `save_failed` when persisting failed (details are logged server-side only). */
  errors?: Array<PolicyGuardErrorCode | "save_failed">;
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

async function listIneligibleStoredUsers(
  knex: Awaited<ReturnType<typeof ensureSsoSettingsPermission>>["knex"],
  tenant: string,
  policy: TenantAuthPolicy
): Promise<LoginPolicyState["ineligibleBreakGlassUsers"]> {
  const storedIds = policy.passwordBreakGlassUserIds;
  if (storedIds.length === 0) return [];
  const candidates = await listBreakGlassCandidates(tenant, storedIds);
  const candidateById = new Map(candidates.map((c) => [c.userId, c]));
  const stale = storedIds.filter((id) => {
    const c = candidateById.get(id);
    return !c || !isValidBreakGlassCandidate(c);
  });
  if (stale.length === 0) return [];
  const rows = await knex("users")
    .where({ tenant })
    .whereIn("user_id", stale)
    .select("user_id", "first_name", "last_name", "email");
  const rowById = new Map<string, any>(rows.map((row: any) => [row.user_id, row]));
  return stale.map((userId) => {
    const row = rowById.get(userId);
    const c = candidateById.get(userId);
    let reason: LoginPolicyState["ineligibleBreakGlassUsers"][number]["reason"];
    if (!c) reason = row ? "not_internal" : "not_found";
    else if (c.isInactive) reason = "inactive";
    else if (!c.isAdmin) reason = "not_admin";
    else if (!c.twoFactorEnabled) reason = "no_two_factor";
    if (!row) return { userId, reason };
    return {
      userId,
      name: `${row.first_name ?? ""} ${row.last_name ?? ""}`.trim() || row.email,
      email: row.email,
      reason,
    };
  });
}

export async function getLoginPolicyAction(): Promise<LoginPolicyState> {
  const { tenant, knex } = await ensureSsoSettingsPermission();
  const [policy, eligibleBreakGlassAdmins, hasConfiguredSsoProvider] = await Promise.all([
    loadTenantAuthPolicy(tenant, { bypassCache: true }),
    listEligibleAdmins(knex, tenant),
    hasConfiguredProvider(tenant),
  ]);
  const ineligibleBreakGlassUsers = await listIneligibleStoredUsers(knex, tenant, policy);
  return { policy, eligibleBreakGlassAdmins, ineligibleBreakGlassUsers, hasConfiguredSsoProvider };
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
  const requested = applyPolicyChange(previous, updates);

  const [hasConfiguredSsoProvider, breakGlassCandidates] = await Promise.all([
    requested.requireSsoForInternalUsers ? hasConfiguredProvider(tenant) : Promise.resolve(true),
    listBreakGlassCandidates(tenant, requested.passwordBreakGlassUserIds),
  ]);

  const guard = validatePolicyChange({
    next: requested,
    previous,
    hasConfiguredSsoProvider,
    breakGlassCandidates,
  });
  if (!guard.ok) {
    return {
      success: false,
      errors: guard.errors,
      invalidBreakGlassUserIds: guard.invalidBreakGlassUserIds,
    };
  }
  // Server-side prune: never persist what the client sent verbatim.
  const next: TenantAuthPolicy = { ...requested, passwordBreakGlassUserIds: guard.breakGlassUserIds };

  try {
    await saveTenantAuthPolicy({
      knex,
      tenant,
      actorUserId: String(user.user_id),
      currentSettings,
      before: previous,
      after: next,
      prunedBreakGlassUserIds: guard.prunedBreakGlassUserIds,
    });
  } catch (error) {
    // Details stay server-side; the client only gets a generic code.
    logger.error("[loginPolicy] Failed to save login policy", {
      tenant,
      error: error instanceof Error ? error.message : String(error),
    });
    return { success: false, errors: ["save_failed"] };
  }

  return {
    success: true,
    state: {
      policy: next,
      eligibleBreakGlassAdmins: await listEligibleAdmins(knex, tenant),
      ineligibleBreakGlassUsers: await listIneligibleStoredUsers(knex, tenant, next),
      hasConfiguredSsoProvider,
    },
  };
}
