import { tenantDb } from '@alga-psa/db';
import logger from '@alga-psa/core/logger';

export const EMAIL_REPLY_TOKEN_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000;

interface ReplyMarkerPayload {
  token: string;
  ticketId?: string;
  projectId?: string;
  commentId?: string;
  threadId?: string;
  extraMetadata?: Record<string, unknown>;
}

export async function persistReplyToken(
  knex: any,
  tenantId: string,
  payload: ReplyMarkerPayload,
  metadata: { template: string; subject: string; recipient: string }
): Promise<void> {
  try {
    const tableExists = await knex.schema.hasTable('email_reply_tokens');
    if (!tableExists) return;

    const record: Record<string, any> = {
      tenant: tenantId,
      token: payload.token,
      ticket_id: payload.ticketId || null,
      project_id: payload.projectId || null,
      comment_id: payload.commentId || null,
      metadata: JSON.stringify({ ...metadata, ...payload.extraMetadata, threadId: payload.threadId }),
      template: metadata.template,
      recipient_email: metadata.recipient,
      entity_type: payload.projectId ? 'project' : 'ticket',
      expires_at: new Date(Date.now() + EMAIL_REPLY_TOKEN_LIFETIME_MS),
    };

    await tenantDb(knex, tenantId).table('email_reply_tokens')
      .insert(record)
      .onConflict(['tenant', 'token'])
      .ignore();
  } catch (error) {
    logger.warn('[SendEventEmail] Failed to persist email reply token', {
      error: error instanceof Error ? error.message : 'Unknown error',
      tenantId,
      ticketId: payload.ticketId,
      projectId: payload.projectId,
      commentId: payload.commentId,
    });
  }
}
