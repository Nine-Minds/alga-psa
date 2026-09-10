import logger from '@alga-psa/core/logger';
import { createTenantKnex, tenantDb } from '@alga-psa/db';
import { resolveTeamsMeetingGraphConfig } from '../meetings/meetingConfig';
import {
  renewTelephonyCallSubscriptions,
  TEAMS_PHONE_PROVIDER,
} from './callSubscriptions';

/**
 * Teams Phone provider lifecycle on `telephony_providers`.
 *
 * Activation is what creates the Graph callRecords subscription, so a tenant
 * that never opens the panel never subscribes — and a deactivated provider
 * stops receiving notifications because the webhook checks the stored
 * subscription id.
 */

export interface TeamsPhoneProviderState {
  provider: string;
  status: 'not_configured' | 'active' | 'disabled' | 'error';
  autoCreateTickets: boolean;
  subscriptionId: string | null;
  subscriptionExpiresAt: string | null;
  lastError: string | null;
  lastNotificationAt: string | null;
  teamsConfigured: boolean;
}

function toIso(value: unknown): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export async function getTeamsPhoneProviderState(tenantId: string): Promise<TeamsPhoneProviderState> {
  const { knex } = await createTenantKnex(tenantId);
  const row = await tenantDb(knex, tenantId).table('telephony_providers')
    .where({ provider: TEAMS_PHONE_PROVIDER })
    .first();
  const teamsConfig = await resolveTeamsMeetingGraphConfig(tenantId);

  return {
    provider: TEAMS_PHONE_PROVIDER,
    status: (row?.status as TeamsPhoneProviderState['status']) ?? 'not_configured',
    autoCreateTickets: Boolean(row?.auto_create_tickets),
    subscriptionId: row?.subscription_id ?? null,
    subscriptionExpiresAt: toIso(row?.subscription_expires_at),
    lastError: row?.last_error ?? null,
    lastNotificationAt: toIso(row?.last_notification_at),
    teamsConfigured: Boolean(teamsConfig),
  };
}

export async function activateTeamsPhoneProvider(tenantId: string): Promise<TeamsPhoneProviderState> {
  const { knex } = await createTenantKnex(tenantId);
  const db = tenantDb(knex, tenantId);
  const existing = await db.table('telephony_providers')
    .where({ provider: TEAMS_PHONE_PROVIDER })
    .first();

  if (existing) {
    await db.table('telephony_providers')
      .where({ provider_id: existing.provider_id })
      .update({ status: 'active', last_error: null, updated_at: knex.fn.now() });
  } else {
    await db.table('telephony_providers').insert({
      tenant: tenantId,
      provider: TEAMS_PHONE_PROVIDER,
      status: 'active',
      created_at: knex.fn.now(),
      updated_at: knex.fn.now(),
    } as any);
  }

  try {
    await renewTelephonyCallSubscriptions({ tenantId });
  } catch (error) {
    // The row stays active and the maintenance fan-out retries every 30
    // minutes; surfacing the error beats silently rolling the activation back.
    logger.warn('[Telephony] Teams Phone activated but the subscription could not be created yet', {
      tenantId,
      error: error instanceof Error ? error.message : String(error),
    });
    await db.table('telephony_providers')
      .where({ provider: TEAMS_PHONE_PROVIDER })
      .update({ last_error: error instanceof Error ? error.message : String(error), updated_at: knex.fn.now() });
  }

  return getTeamsPhoneProviderState(tenantId);
}

export async function deactivateTeamsPhoneProvider(tenantId: string): Promise<TeamsPhoneProviderState> {
  const { knex } = await createTenantKnex(tenantId);
  await tenantDb(knex, tenantId).table('telephony_providers')
    .where({ provider: TEAMS_PHONE_PROVIDER })
    .update({ status: 'disabled', subscription_id: null, subscription_expires_at: null, updated_at: knex.fn.now() });

  return getTeamsPhoneProviderState(tenantId);
}

export async function setTeamsPhoneAutoTicketPolicy(
  tenantId: string,
  autoCreateTickets: boolean,
): Promise<TeamsPhoneProviderState> {
  const { knex } = await createTenantKnex(tenantId);
  await tenantDb(knex, tenantId).table('telephony_providers')
    .where({ provider: TEAMS_PHONE_PROVIDER })
    .update({ auto_create_tickets: autoCreateTickets, updated_at: knex.fn.now() });

  return getTeamsPhoneProviderState(tenantId);
}
