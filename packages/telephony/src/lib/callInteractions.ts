import { tenantDb } from '@alga-psa/db';
import type { CallDirection } from '../types';
import { formatCallNumber } from './phoneNumbers';

/** The system interaction type every captured call is filed under. */
export const CALL_INTERACTION_TYPE_NAME = 'Call';

export interface CallTitleInput {
  direction: CallDirection;
  callerNumberE164?: string | null;
  callerNumberRaw?: string | null;
  calleeNumberE164?: string | null;
  calleeNumberRaw?: string | null;
}

/** "Inbound call from +1 (555) 123-4567" — the counterparty, never our own DID. */
export function buildCallInteractionTitle(input: CallTitleInput): string {
  const counterparty = input.direction === 'outbound'
    ? formatCallNumber(input.calleeNumberE164, input.calleeNumberRaw)
    : formatCallNumber(input.callerNumberE164, input.callerNumberRaw);

  const prefix = input.direction === 'outbound'
    ? 'Outbound call to'
    : input.direction === 'missed'
      ? 'Missed call from'
      : 'Inbound call from';

  return `${prefix} ${counterparty}`;
}

export function buildCallInteractionNotes(input: CallTitleInput & {
  provider: string;
  durationSeconds?: number | null;
}): string {
  const lines = [
    `Provider: ${input.provider}`,
    `Direction: ${input.direction}`,
    `From: ${formatCallNumber(input.callerNumberE164, input.callerNumberRaw)}`,
    `To: ${formatCallNumber(input.calleeNumberE164, input.calleeNumberRaw)}`,
  ];

  if (typeof input.durationSeconds === 'number') {
    lines.push(`Duration: ${formatDuration(input.durationSeconds)}`);
  }

  return lines.join('\n');
}

export function formatDuration(seconds: number): string {
  const safe = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(safe / 60);
  const remainder = safe % 60;
  return `${minutes}m ${String(remainder).padStart(2, '0')}s`;
}

export async function resolveCallInteractionTypeId(knex: any, tenantId: string): Promise<string | null> {
  const row = await tenantDb(knex, tenantId).table('system_interaction_types')
    .where({ type_name: CALL_INTERACTION_TYPE_NAME })
    .first('type_id');

  return row?.type_id ?? null;
}

/**
 * `interactions.user_id` is NOT NULL, but an ingested call has no acting user.
 * Fall back to a stable internal user (oldest active internal account) so the
 * timeline entry has an owner; a manual resolve stamps the real actor instead.
 */
export async function resolveTelephonyActorUserId(
  knex: any,
  tenantId: string,
  preferredUserId?: string | null,
): Promise<string | null> {
  if (preferredUserId) {
    return preferredUserId;
  }

  const row = await tenantDb(knex, tenantId).table('users')
    .where({ user_type: 'internal', is_inactive: false })
    .orderBy('created_at', 'asc')
    .first('user_id');

  return row?.user_id ?? null;
}
