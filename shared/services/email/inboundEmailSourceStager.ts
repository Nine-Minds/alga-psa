/**
 * Durable inbound email source staging.
 *
 * Stages raw MIME to deterministic object keys so a provider message's source
 * survives provider-side moves/deletes and retries can rebuild work without
 * provider access:
 *
 *   `inbound-email/<tenant>/<provider-id>/<sha256(normalized-id)>/<source-sha256>.eml`
 *
 * Uploading identical bytes is safe; a different digest for the same normalized
 * identity is retained as error provenance and requires reconciliation rather
 * than silently replacing the authoritative source. Reads always verify the
 * digest.
 */

import { createHash } from 'node:crypto';
import { simpleParser } from 'mailparser';
import type { EmailMessageDetails } from '../../interfaces/inbound-email.interfaces';
import { buildInboundSourceObjectKey, normalizeInboundMessageIdentity } from './inboundEmailIdentity';
import { extractMessageIds } from './inboundEmailMimeHelpers';
import type { InboundProviderType } from '../../interfaces/inbound-email.interfaces';

export interface StagedInboundSource {
  objectKey: string;
  sha256: string;
  sizeBytes: number;
  uploaded: boolean;
}

export interface StageInboundSourceParams {
  tenant: string;
  providerId: string;
  providerType: InboundProviderType;
  normalizedMessageId: string;
  rawMime: Buffer;
}

export async function getStorageProvider(): Promise<{ upload: any; download: any; exists: any }> {
  const module: any = await import('@alga-psa/storage/StorageProviderFactory');
  const provider = await module.StorageProviderFactory.createProvider();
  return provider;
}

function sha256Hex(input: Buffer | string): string {
  return createHash('sha256').update(input).digest('hex');
}

/**
 * Stage raw MIME. Deterministic key means a crash after upload but before DB
 * write makes retry a no-op upload of identical bytes.
 */
export async function stageInboundSourceMime(params: StageInboundSourceParams): Promise<StagedInboundSource> {
  const sha256 = sha256Hex(params.rawMime);
  const objectKey = buildInboundSourceObjectKey({
    tenant: params.tenant,
    providerId: params.providerId,
    normalizedMessageId: params.normalizedMessageId,
    sourceSha256: sha256,
  });

  const provider = await getStorageProvider();
  let exists = false;
  try {
    exists = await provider.exists(objectKey);
  } catch {
    exists = false;
  }
  if (exists) {
    return { objectKey, sha256, sizeBytes: params.rawMime.length, uploaded: false };
  }

  await provider.upload(params.rawMime, objectKey, { mime_type: 'message/rfc822' });
  return { objectKey, sha256, sizeBytes: params.rawMime.length, uploaded: true };
}

export interface ReadStagedSourceParams {
  tenant: string;
  providerId: string;
  objectKey: string;
  expectedSha256: string;
}

/**
 * Read and digest-verify a staged source. A digest mismatch is a hard error:
 * the authoritative source must never be silently replaced.
 */
export async function readStagedSourceMime(params: ReadStagedSourceParams): Promise<Buffer> {
  const provider = await getStorageProvider();
  const buffer = await provider.download(params.objectKey);
  const actual = sha256Hex(buffer);
  if (actual !== params.expectedSha256) {
    throw new Error(
      `inbound source digest mismatch: expected ${params.expectedSha256} got ${actual} for ${params.objectKey}`
    );
  }
  return buffer;
}

export interface ParsedStagedMime {
  emailData: EmailMessageDetails;
  normalizedMessageId: string;
  rfcMessageId: string | null;
  providerMessageId: string | null;
}

/**
 * Parse staged raw MIME into `EmailMessageDetails` plus the normalized durable
 * identity. The provider message id is passed as the fallback identity so a
 * message without an RFC Message-ID still dedupes by its provider id.
 */
export async function parseStagedMimeIntoEmailDetails(params: {
  tenant: string;
  providerId: string;
  providerType: InboundProviderType;
  rawMime: Buffer;
  fallbackProviderMessageId?: string | null;
  mailbox?: string | null;
  uidValidity?: string | null;
  uid?: string | number | null;
}): Promise<ParsedStagedMime> {
  const parsed: any = await simpleParser(params.rawMime);
  const rfcMessageId = typeof parsed?.messageId === 'string' ? parsed.messageId : null;
  const identity = normalizeInboundMessageIdentity({
    providerType: params.providerType,
    rfcMessageId,
    providerMessageId: params.fallbackProviderMessageId,
    mailbox: params.mailbox,
    uidValidity: params.uidValidity,
    uid: params.uid,
  });
  if (!identity) {
    throw new Error('inbound message identity could not be derived from staged source');
  }

  const from = parsed?.from?.value?.[0];
  const to = parsed?.to?.value || [];
  const cc = parsed?.cc?.value || [];
  const references = extractMessageIds(parsed?.references);
  const inReplyTo = extractMessageIds(parsed?.inReplyTo)[0];
  const threadId = references[0] || inReplyTo;

  const emailData: EmailMessageDetails = {
    id: identity.rfcMessageId ?? identity.providerMessageId ?? params.fallbackProviderMessageId ?? '',
    provider: params.providerType,
    providerId: params.providerId,
    tenant: params.tenant,
    receivedAt: parsed?.date ? new Date(parsed.date).toISOString() : new Date().toISOString(),
    from: {
      email: from?.address || '',
      name: from?.name || undefined,
    },
    to: to.map((item: any) => ({
      email: item?.address || '',
      name: item?.name || undefined,
    })),
    cc: cc.length
      ? cc.map((item: any) => ({
          email: item?.address || '',
          name: item?.name || undefined,
        }))
      : undefined,
    subject: parsed?.subject || '',
    body: {
      text: parsed?.text || '',
      html: parsed?.html ? String(parsed.html) : undefined,
    },
    attachments: Array.isArray(parsed?.attachments)
      ? parsed.attachments.map((attachment: any, index: number) => {
          const contentBuffer = Buffer.isBuffer(attachment?.content)
            ? attachment.content
            : Buffer.from(attachment?.content || '');
          return {
            id: String(attachment?.contentId || attachment?.checksum || `${identity.normalized}-att-${index}`),
            name: String(attachment?.filename || `attachment-${index + 1}`),
            contentType: String(attachment?.contentType || 'application/octet-stream'),
            size: Number(attachment?.size || contentBuffer.length || 0),
            contentId: typeof attachment?.contentId === 'string' && attachment.contentId.trim() ? attachment.contentId : undefined,
            isInline: Boolean(attachment?.contentDisposition === 'inline'),
            content: contentBuffer.toString('base64'),
          };
        })
      : [],
    threadId: threadId || undefined,
    references: references.length ? references : undefined,
    inReplyTo: inReplyTo || undefined,
    rawMimeBase64: params.rawMime.toString('base64'),
  };

  return {
    emailData,
    normalizedMessageId: identity.normalized,
    rfcMessageId: identity.rfcMessageId,
    providerMessageId: identity.providerMessageId,
  };
}
