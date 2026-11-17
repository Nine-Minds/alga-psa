// Deliberately NOT a 'use server' module. Everything exported from a
// 'use server' file becomes a client-invokable server action, and
// `recordMicrosoftEmailAdminConsentFromState` has no auth guard: its only
// authorisation is the signed state the callback route has already validated.
// Keep this file out of every 'use server' barrel and out of package exports.
import { createTenantKnex, tenantDb } from '@alga-psa/db';
import {
  hasMicrosoftProfileCapability,
  normalizeMicrosoftProfileCapabilities,
} from '../actions/integrations/microsoftShared';
import { getMicrosoftPlatformClientId } from './microsoftConsumerProfileResolution';
import {
  applyMicrosoftPlatformAppServedConsumers,
  isMicrosoftPlatformClientId,
} from './microsoftPlatformApp';

export const MICROSOFT_EMAIL_CONSENT_EXPECTED_ERRORS = [
  'The pending Microsoft Email profile no longer exists',
  'The pending Microsoft profile is not enabled for Email',
  'Microsoft administrator consent was returned for a different application',
] as const;

function normalizeClientId(value: string): string {
  return value
    .normalize('NFKC')
    .replace(/[​-‍﻿]/g, '')
    .trim();
}

/**
 * The single writer of `email_admin_consent_granted_at`. Validates the pending
 * profile, stamps consent (keeping the original timestamp when the same Microsoft
 * tenant was already granted) and always (re)binds the `email` consumer. When the
 * consented profile is the AlgaPSA-supplied (platform) app, it also binds every
 * other consumer the platform app serves that has no binding yet, never
 * replacing a binding to a different profile. Tenant-owned profiles: email only.
 * `actorUserId` is null when consent arrives via a copied approval link.
 */
export async function writeMicrosoftEmailAdminConsent(input: {
  algaTenant: string;
  clientId: string;
  profileId: string;
  microsoftTenantId?: string;
  actorUserId: string | null;
}): Promise<void> {
  const { knex } = await createTenantKnex();
  const tenant = input.algaTenant;
  const now = new Date();
  const platformClientId = await getMicrosoftPlatformClientId();

  await knex.transaction(async (trx: any) => {
    const db = tenantDb(trx, tenant);
    const profile = await db.table<any>('microsoft_profiles')
      .where({ profile_id: input.profileId })
      .first();

    if (!profile || profile.is_archived) {
      throw new Error('The pending Microsoft Email profile no longer exists');
    }
    if (!hasMicrosoftProfileCapability(normalizeMicrosoftProfileCapabilities(profile.capabilities), 'email')) {
      throw new Error('The pending Microsoft profile is not enabled for Email');
    }
    if (normalizeClientId(profile.client_id) !== normalizeClientId(input.clientId)) {
      throw new Error('Microsoft administrator consent was returned for a different application');
    }

    const microsoftTenantId = input.microsoftTenantId || null;
    const alreadyGranted =
      Boolean(profile.email_admin_consent_granted_at) &&
      (profile.email_admin_consent_tenant_id || null) === microsoftTenantId;

    if (!alreadyGranted) {
      await db.table('microsoft_profiles')
        .where({ profile_id: input.profileId })
        .update({
          email_admin_consent_required: true,
          email_admin_consent_granted_at: now,
          email_admin_consent_tenant_id: microsoftTenantId,
          updated_by: input.actorUserId,
          updated_at: now,
        });
    }

    // Binding is performed even on the idempotent path: a second admin may
    // approve a profile that is not yet bound to Email.
    const existing = await db.table<any>('microsoft_profile_consumer_bindings')
      .where({ consumer_type: 'email' })
      .first();
    if (existing) {
      await db.table('microsoft_profile_consumer_bindings')
        .where({ consumer_type: 'email' })
        .update({ profile_id: input.profileId, updated_by: input.actorUserId, updated_at: now });
    } else {
      await db.table('microsoft_profile_consumer_bindings').insert({
        tenant,
        consumer_type: 'email',
        profile_id: input.profileId,
        created_by: input.actorUserId,
        updated_by: input.actorUserId,
        created_at: now,
        updated_at: now,
      });
    }

    if (isMicrosoftPlatformClientId(profile.client_id, platformClientId)) {
      const applied = await applyMicrosoftPlatformAppServedConsumers(
        db,
        tenant,
        profile,
        undefined,
        input.actorUserId
      );
      if (applied.changed) {
        console.info('[microsoftEmailAdminConsent] bound supplied-app consumers at consent', {
          tenant,
          profileId: input.profileId,
          addedCapabilities: applied.addedCapabilities,
          addedBindings: applied.addedBindings,
        });
      }
    }
  });
}

/**
 * Internal, unguarded. Imported only by the email-setup callback route, which
 * has verified the HMAC-signed, unexpired, purpose-scoped state and Microsoft's
 * `admin_consent=True` before calling.
 */
export async function recordMicrosoftEmailAdminConsentFromState(input: {
  algaTenant: string;
  clientId: string;
  profileId: string;
  microsoftTenantId?: string;
}): Promise<{ success: boolean; error?: string; profileId?: string }> {
  try {
    await writeMicrosoftEmailAdminConsent({ ...input, actorUserId: null });
    return { success: true, profileId: input.profileId };
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    return {
      success: false,
      error: (MICROSOFT_EMAIL_CONSENT_EXPECTED_ERRORS as readonly string[]).includes(message)
        ? message
        : 'Failed to record Microsoft administrator consent',
    };
  }
}
