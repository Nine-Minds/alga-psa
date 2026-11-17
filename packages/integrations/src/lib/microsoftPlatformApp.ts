// Deliberately NOT a 'use server' module: the reconcile and the served-consumer
// definition are internal helpers (the reconcile has no auth guard of its own;
// callers are already tenant-scoped status/consent paths).
import { createTenantKnex, tenantDb } from '@alga-psa/db';
import { isSelfHostLicensing } from '@alga-psa/licensing';
import {
  hasMicrosoftProfileCapability,
  normalizeMicrosoftProfileCapabilities,
  type MicrosoftProfileConsumer,
} from '../actions/integrations/microsoftShared';
import { getMicrosoftPlatformAppServedConsumers } from './microsoftPlatformAppServed';

export { getMicrosoftPlatformAppServedConsumers };
import { getMicrosoftPlatformClientId } from './microsoftConsumerProfileResolution';

/** Display name for new supplied-app profiles. It must not say "Email": the app serves more than email. */
export const MICROSOFT_PLATFORM_PROFILE_DISPLAY_NAME = 'Alga platform Microsoft app';

export function normalizeMicrosoftClientIdForComparison(value: string | null | undefined): string {
  return (value || '')
    .normalize('NFKC')
    .replace(/[​-‍﻿]/g, '')
    .trim()
    .toLowerCase();
}

export function isMicrosoftPlatformClientId(
  clientId: string | null | undefined,
  platformClientId: string | null | undefined
): boolean {
  const platform = normalizeMicrosoftClientIdForComparison(platformClientId);
  return Boolean(platform) && normalizeMicrosoftClientIdForComparison(clientId) === platform;
}

/** The supplied app is offered on hosted deployments that have platform credentials. */
export async function isMicrosoftPlatformAppOffered(): Promise<boolean> {
  if (await isSelfHostLicensing()) return false;
  return Boolean(await getMicrosoftPlatformClientId());
}

export interface MicrosoftPlatformReconcileResult {
  changed: boolean;
  profileId?: string;
  addedCapabilities: MicrosoftProfileConsumer[];
  addedBindings: MicrosoftProfileConsumer[];
}

const NOOP: MicrosoftPlatformReconcileResult = { changed: false, addedCapabilities: [], addedBindings: [] };

/**
 * Applies the served-consumer rules to one platform profile inside the caller's
 * transaction: add missing served capabilities and missing bindings, never
 * replacing a binding to another profile. Shared by consent-time binding and
 * reconcile-on-use so the two cannot drift.
 */
export async function applyMicrosoftPlatformAppServedConsumers(
  db: ReturnType<typeof tenantDb>,
  tenant: string,
  profile: { profile_id: string; capabilities: unknown },
  served: readonly MicrosoftProfileConsumer[] = getMicrosoftPlatformAppServedConsumers(),
  actorUserId: string | null = null
): Promise<MicrosoftPlatformReconcileResult> {
  const bindings = (await db.table<any>('microsoft_profile_consumer_bindings')) as any[];
  const bindingFor = (consumer: string) => bindings.find((row) => row.consumer_type === consumer);
  const capabilities = normalizeMicrosoftProfileCapabilities(profile.capabilities);
  const addedCapabilities: MicrosoftProfileConsumer[] = [];
  const addedBindings: MicrosoftProfileConsumer[] = [];
  const now = new Date();

  for (const consumer of served) {
    const existing = bindingFor(consumer);
    if (existing && existing.profile_id !== profile.profile_id) continue; // never override
    if (!hasMicrosoftProfileCapability(capabilities, consumer)) {
      capabilities.push(consumer);
      addedCapabilities.push(consumer);
    }
    if (!existing) {
      const inserted = await db.table('microsoft_profile_consumer_bindings')
        .insert({
          tenant,
          consumer_type: consumer,
          profile_id: profile.profile_id,
          created_by: actorUserId,
          updated_by: actorUserId,
          created_at: now,
          updated_at: now,
        })
        .onConflict(['tenant', 'consumer_type'])
        .ignore()
        .returning('consumer_type');
      if (Array.isArray(inserted) ? inserted.length > 0 : Boolean(inserted)) addedBindings.push(consumer);
    }
  }

  if (addedCapabilities.length > 0) {
    await db.table('microsoft_profiles')
      .where({ profile_id: profile.profile_id })
      .update({ capabilities: JSON.stringify(capabilities), updated_at: now, updated_by: actorUserId });
  }

  return {
    changed: addedCapabilities.length > 0 || addedBindings.length > 0,
    profileId: profile.profile_id,
    addedCapabilities,
    addedBindings,
  };
}

/**
 * Reconcile-on-use for the tenant's supplied-app profile (precedent:
 * `ensureLegacyMicrosoftProfileBackfill`). For the tenant's non-archived,
 * admin-consented profile that carries the platform client id, add every served
 * capability it lacks and every served-consumer binding that is missing.
 *
 * Rules:
 *  - never replaces an existing binding to another profile; a consumer bound
 *    elsewhere is skipped entirely (capability included);
 *  - profiles still pending consent, archived, or tenant-owned are untouched;
 *  - no-op when the supplied app is not offered (self-hosted licensing / no
 *    platform credentials);
 *  - idempotent and concurrency-safe: one transaction holds a row lock on the
 *    profile (`FOR UPDATE`) and bindings use `ON CONFLICT (tenant, consumer_type)
 *    DO NOTHING` (the table's primary key), so concurrent runs serialise and a
 *    lost race can never replace or duplicate a binding.
 * Logs tenant and profile ids only, never secrets.
 */
export async function reconcileMicrosoftPlatformAppProfile(
  tenant: string
): Promise<MicrosoftPlatformReconcileResult> {
  if (await isSelfHostLicensing()) return NOOP;
  const platformClientId = await getMicrosoftPlatformClientId();
  if (!platformClientId) return NOOP;

  const served = getMicrosoftPlatformAppServedConsumers();
  const { knex } = await createTenantKnex();

  const result = await knex.transaction(async (trx: any): Promise<MicrosoftPlatformReconcileResult> => {
    const db = tenantDb(trx, tenant);
    const candidates = (await db.table<any>('microsoft_profiles')
      .where({ is_archived: false })
      .whereNotNull('email_admin_consent_granted_at')
      .orderBy('created_at', 'asc')
      .forUpdate()) as any[];
    const platformProfiles = candidates.filter((row) => isMicrosoftPlatformClientId(row.client_id, platformClientId));
    if (platformProfiles.length === 0) return NOOP;

    const bindings = (await db.table<any>('microsoft_profile_consumer_bindings')) as any[];
    // Prefer the profile already serving a consumer, else the oldest.
    const profile =
      platformProfiles.find((row) =>
        served.some((c) => bindings.find((b) => b.consumer_type === c)?.profile_id === row.profile_id)) ||
      platformProfiles[0];
    return applyMicrosoftPlatformAppServedConsumers(db, tenant, profile, served);
  });

  if (result.changed) {
    console.info('[microsoftPlatformApp] reconciled supplied-app profile', {
      tenant,
      profileId: result.profileId,
      addedCapabilities: result.addedCapabilities,
      addedBindings: result.addedBindings,
    });
  }
  return result;
}
