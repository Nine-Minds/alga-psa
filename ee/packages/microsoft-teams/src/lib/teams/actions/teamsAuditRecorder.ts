import crypto from 'node:crypto';
import logger from '@alga-psa/core/logger';
import { createTenantKnex } from '@alga-psa/db';

export type TeamsAuditSurface = 'bot' | 'message_extension' | 'quick_action' | 'tab';
export type TeamsAuditResultStatus = 'success' | 'failure';
export type TeamsAuditActionId =
  | 'assign_ticket'
  | 'add_note'
  | 'reply_to_contact'
  | 'log_time'
  | 'approval_response'
  | 'create_ticket_from_message'
  | 'update_from_message';

export interface TeamsAuditEventRow {
  tenant: string;
  event_id?: string;
  actor_user_id: string | null;
  microsoft_user_id: string | null;
  surface: TeamsAuditSurface;
  action_id: TeamsAuditActionId;
  target_type: string | null;
  target_id: string | null;
  idempotency_key: string | null;
  payload_hash: string | null;
  result_status: TeamsAuditResultStatus;
  error_code: string | null;
}

export interface WriteTeamsAuditEventInput {
  tenant: string;
  actorUserId?: string | null;
  microsoftUserId?: string | null;
  surface: TeamsAuditSurface;
  actionId: TeamsAuditActionId;
  targetType?: string | null;
  targetId?: string | null;
  idempotencyKey?: string | null;
  payload?: unknown;
  resultStatus: TeamsAuditResultStatus;
  errorCode?: string | null;
}

function normalizeOptionalString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => canonicalize(item));
  }

  if (!value || typeof value !== 'object') {
    return value ?? null;
  }

  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(value as Record<string, unknown>).sort()) {
    sorted[key] = canonicalize((value as Record<string, unknown>)[key]);
  }
  return sorted;
}

export function canonicalizeTeamsAuditPayload(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

export function computeTeamsAuditPayloadHash(value: unknown): string {
  return crypto
    .createHash('sha256')
    .update(canonicalizeTeamsAuditPayload(value))
    .digest('hex');
}

export async function writeTeamsAuditEvent(input: WriteTeamsAuditEventInput): Promise<void> {
  try {
    const { knex, tenant } = await createTenantKnex(input.tenant);
    const scopedTenant = tenant || input.tenant;
    const row: TeamsAuditEventRow = {
      tenant: scopedTenant,
      actor_user_id: normalizeOptionalString(input.actorUserId),
      microsoft_user_id: normalizeOptionalString(input.microsoftUserId),
      surface: input.surface,
      action_id: input.actionId,
      target_type: normalizeOptionalString(input.targetType),
      target_id: normalizeOptionalString(input.targetId),
      idempotency_key: normalizeOptionalString(input.idempotencyKey),
      payload_hash: input.payload === undefined ? null : computeTeamsAuditPayloadHash(input.payload),
      result_status: input.resultStatus,
      error_code: normalizeOptionalString(input.errorCode),
    };

    await knex('teams_audit_events').insert(row);
  } catch (error) {
    logger.warn('[TeamsAuditRecorder] Failed to persist Teams action audit event', {
      tenant: input.tenant,
      actionId: input.actionId,
      resultStatus: input.resultStatus,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
