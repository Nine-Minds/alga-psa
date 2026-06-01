import crypto from 'node:crypto';
import logger from '@alga-psa/core/logger';
import { createTenantKnex } from '@alga-psa/db';

export type TeamsDeliveryStatus = 'skipped' | 'sent' | 'delivered' | 'failed';
export type TeamsDeliveryDestinationType = 'user_activity' | 'chat' | 'channel' | 'bot_test';
export type TeamsDeliveryErrorCode =
  | 'graph_throttled'
  | 'graph_unauthorized'
  | 'graph_not_found'
  | 'graph_server_error'
  | 'user_not_mapped'
  | 'addon_inactive'
  | 'integration_inactive'
  | 'package_misconfigured'
  | 'transient'
  | 'unknown';

export interface TeamsDeliveryRow {
  tenant: string;
  delivery_id: string;
  internal_notification_id: string | null;
  category: string | null;
  destination_type: TeamsDeliveryDestinationType;
  destination_id: string;
  attempt_number: number;
  idempotency_key: string;
  provider_message_id: string | null;
  status: TeamsDeliveryStatus;
  error_code: TeamsDeliveryErrorCode | null;
  error_message: string | null;
  retryable: boolean | null;
  provider_request_id: string | null;
  sent_at: string | null;
  delivered_at: string | null;
  responded_at: string | null;
}

export interface WriteTeamsDeliveryRowInput {
  tenant: string;
  internalNotificationId?: string | null;
  category?: string | null;
  destinationType: TeamsDeliveryDestinationType;
  destinationId: string;
  attemptNumber?: number | null;
  idempotencyNonce?: string | null;
  status: TeamsDeliveryStatus;
  errorCode?: TeamsDeliveryErrorCode | null;
  errorMessage?: string | null;
  retryable?: boolean | null;
  providerMessageId?: string | null;
  providerRequestId?: string | null;
  sentAt?: string | Date | null;
  deliveredAt?: string | Date | null;
  respondedAt?: string | Date | null;
}

export interface WriteTeamsDeliveryRowResult {
  inserted: boolean;
  idempotencyKey: string;
  deliveryId: string | null;
}

const MAX_ERROR_MESSAGE_LENGTH = 1024;

function normalizeAttemptNumber(value: number | null | undefined): number {
  return Number.isInteger(value) && Number(value) > 0 ? Number(value) : 1;
}

function normalizeOptionalString(value: string | null | undefined): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function normalizeTimestamp(value: string | Date | null | undefined): string | null {
  if (!value) {
    return null;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  const normalized = normalizeOptionalString(value);
  return normalized;
}

export function truncateTeamsDeliveryErrorMessage(value: string | null | undefined): string | null {
  const normalized = normalizeOptionalString(value);
  if (!normalized) {
    return null;
  }

  return normalized.length > MAX_ERROR_MESSAGE_LENGTH
    ? normalized.slice(0, MAX_ERROR_MESSAGE_LENGTH)
    : normalized;
}

export function computeTeamsDeliveryIdempotencyKey(input: {
  internalNotificationId?: string | null;
  tenant: string;
  destinationType: TeamsDeliveryDestinationType;
  destinationId: string;
  attemptNumber?: number | null;
  idempotencyNonce?: string | null;
}): string {
  const attemptNumber = normalizeAttemptNumber(input.attemptNumber);
  return crypto
    .createHash('sha256')
    .update([
      input.internalNotificationId ?? '',
      input.tenant,
      input.destinationType,
      input.destinationId,
      String(attemptNumber),
      input.idempotencyNonce ?? '',
    ].join('|'))
    .digest('hex');
}

export async function writeTeamsDeliveryRow(input: WriteTeamsDeliveryRowInput): Promise<WriteTeamsDeliveryRowResult> {
  const attemptNumber = normalizeAttemptNumber(input.attemptNumber);
  const idempotencyKey = computeTeamsDeliveryIdempotencyKey({
    internalNotificationId: input.internalNotificationId,
    tenant: input.tenant,
    destinationType: input.destinationType,
    destinationId: input.destinationId,
    attemptNumber,
    idempotencyNonce: input.idempotencyNonce ?? null,
  });
  const deliveryId = crypto.randomUUID();

  try {
    const { knex, tenant } = await createTenantKnex(input.tenant);
    const scopedTenant = tenant || input.tenant;

    const row: TeamsDeliveryRow = {
      tenant: scopedTenant,
      delivery_id: deliveryId,
      internal_notification_id: normalizeOptionalString(input.internalNotificationId ?? null),
      category: normalizeOptionalString(input.category ?? null),
      destination_type: input.destinationType,
      destination_id: input.destinationId,
      attempt_number: attemptNumber,
      idempotency_key: idempotencyKey,
      provider_message_id: normalizeOptionalString(input.providerMessageId ?? null),
      status: input.status,
      error_code: input.errorCode ?? null,
      error_message: truncateTeamsDeliveryErrorMessage(input.errorMessage ?? null),
      retryable: typeof input.retryable === 'boolean' ? input.retryable : null,
      provider_request_id: normalizeOptionalString(input.providerRequestId ?? null),
      sent_at: normalizeTimestamp(input.sentAt ?? null),
      delivered_at: normalizeTimestamp(input.deliveredAt ?? null),
      responded_at: normalizeTimestamp(input.respondedAt ?? null),
    };

    const result = await knex('teams_notification_deliveries')
      .insert(row)
      .onConflict(['tenant', 'idempotency_key'])
      .ignore()
      .returning('delivery_id');

    const inserted = Array.isArray(result) && result.length > 0;

    return {
      inserted,
      idempotencyKey,
      deliveryId: inserted ? deliveryId : null,
    };
  } catch (error) {
    logger.warn('[TeamsDeliveryRecorder] Failed to persist Teams notification delivery row', {
      tenant: input.tenant,
      internalNotificationId: input.internalNotificationId,
      status: input.status,
      error: error instanceof Error ? error.message : String(error),
    });

    return {
      inserted: false,
      idempotencyKey,
      deliveryId: null,
    };
  }
}
