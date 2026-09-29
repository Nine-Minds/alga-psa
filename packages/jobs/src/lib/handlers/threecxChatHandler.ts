import logger from '@alga-psa/core/logger';
import { runWithTenant } from '@alga-psa/db';
import type { CanonicalChatRecord } from '@alga-psa/telephony/types';

export const THREECX_CHAT_JOB = 'process-threecx-chat';

export interface ThreecxChatJobData extends Record<string, unknown> {
  tenantId: string;
  chat: CanonicalChatRecord;
}

const isEnterpriseEdition =
  (process.env.EDITION ?? '').toLowerCase() === 'ee' ||
  (process.env.EDITION ?? '').toLowerCase() === 'enterprise' ||
  (process.env.NEXT_PUBLIC_EDITION ?? '').toLowerCase() === 'enterprise';

/** Journals one 3CX chat under tenant scope (enqueued by the report-chat route). */
export async function processThreecxChat(data: ThreecxChatJobData): Promise<void> {
  if (!isEnterpriseEdition) {
    logger.info('[Telephony] Skipping 3CX chat outside Enterprise Edition', {
      tenantId: data.tenantId,
    });
    return;
  }

  await runWithTenant(data.tenantId, async () => {
    const { ingestChat } = await import('@alga-psa/telephony');
    const outcome = await ingestChat({ tenantId: data.tenantId, chat: data.chat });
    logger.info('[Telephony] 3CX chat processed', {
      tenantId: data.tenantId,
      provider: data.chat.provider,
      providerChatId: data.chat.providerChatId,
      outcome: outcome.status,
      matchStatus: outcome.status === 'ingested' ? outcome.matchStatus : undefined,
      interactionId: outcome.status === 'skipped' ? undefined : outcome.interactionId,
    });
  });
}
