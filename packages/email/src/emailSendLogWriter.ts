import logger from '@alga-psa/core/logger';
import { createTenantKnex } from '@alga-psa/db';
import type {
  EmailMessage as ProviderEmailMessage,
  EmailSendResult as ProviderEmailSendResult,
} from '@alga-psa/types';

const EMAIL_LOG_TABLE = 'email_sending_logs';

export interface EmailSendLogContext {
  entityType?: string;
  entityId?: string;
  contactId?: string;
  notificationSubtypeId?: number;
}

export interface WriteEmailSendResultLogParams extends EmailSendLogContext {
  serviceName: string;
  tenantId: string | null;
  providerResult: ProviderEmailSendResult;
  message: ProviderEmailMessage;
}

export function buildFailedProviderResult(params: {
  providerId: string;
  providerType: string;
  error: unknown;
  metadata?: Record<string, any>;
  sentAt?: Date;
}): ProviderEmailSendResult {
  const errorMessage = params.error instanceof Error ? params.error.message : String(params.error || 'Unknown error');

  return {
    success: false,
    messageId: undefined,
    providerId: params.providerId,
    providerType: params.providerType,
    error: errorMessage,
    metadata: params.metadata ?? { error: errorMessage },
    sentAt: params.sentAt ?? new Date(),
  };
}

export async function writeEmailSendResultLog(params: WriteEmailSendResultLogParams): Promise<void> {
  if (!params.tenantId) {
    return;
  }

  try {
    const { knex } = await createTenantKnex(params.tenantId);

    const toAddresses = params.message.to.map((addr) => addr.email);
    const ccAddresses = params.message.cc?.map((addr) => addr.email) ?? null;
    const bccAddresses = params.message.bcc?.map((addr) => addr.email) ?? null;

    await knex(EMAIL_LOG_TABLE).insert({
      tenant: params.tenantId,
      message_id: params.providerResult.messageId ?? null,
      provider_id: params.providerResult.providerId,
      provider_type: params.providerResult.providerType,
      from_address: params.message.from.email,
      to_addresses: JSON.stringify(toAddresses),
      cc_addresses: ccAddresses ? JSON.stringify(ccAddresses) : null,
      bcc_addresses: bccAddresses ? JSON.stringify(bccAddresses) : null,
      subject: params.message.subject,
      status: params.providerResult.success ? 'sent' : 'failed',
      error_message: params.providerResult.error ?? null,
      metadata: params.providerResult.metadata ?? null,
      sent_at: params.providerResult.sentAt ?? new Date(),
      entity_type: params.entityType ?? null,
      entity_id: params.entityId ?? null,
      contact_id: params.contactId ?? null,
      notification_subtype_id: params.notificationSubtypeId ?? null,
    });
  } catch (error) {
    logger.warn(`[${params.serviceName}] Failed to write email_sending_logs record`, {
      tenantId: params.tenantId,
      providerId: params.providerResult.providerId,
      providerType: params.providerResult.providerType,
      status: params.providerResult.success ? 'sent' : 'failed',
      subject: params.message.subject,
      toCount: params.message.to.length,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}
