import { createHash } from 'node:crypto';
import type { EmailAddress, EmailMessage } from '@alga-psa/types';

/** A server-produced review is a consistency check, not mailbox authorization.
 * The conversation command must retain current sender and destination authority. */
export interface ReviewedEmailIntent {
  senderRevision: string;
  messageHash: string;
}
export interface ReviewedEmailPreview extends ReviewedEmailIntent {
  providerId: string;
  providerType: string;
  from: EmailAddress;
  replyTo?: EmailAddress;
  to: EmailAddress[];
  cc: EmailAddress[];
  subject: string;
  html: string;
  text: string;
  files: Array<{ filename: string; contentType?: string; size: number }>;
}
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const invalid = () => { throw new Error('Invalid reviewed email'); };
function address(value: EmailAddress) {
  if (!value || typeof value.email !== 'string' || !/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(value.email) ||
      /[\u0000-\u001f\u007f]/.test(value.email) || (value.name !== undefined && (typeof value.name !== 'string' || /[\u0000-\u001f\u007f]/.test(value.name)))) return invalid();
  return { email: value.email, ...(value.name ? { name: value.name } : {}) };
}
function fileBytes(file: NonNullable<EmailMessage['attachments']>[number]): Buffer {
  if (!file || typeof file.filename !== 'string' || !file.filename || /[\u0000-\u001f\u007f]/.test(file.filename) ||
      Object.keys(file).some(key => !['filename', 'content', 'contentType', 'cid'].includes(key))) return invalid();
  if (file.contentType !== undefined && (typeof file.contentType !== 'string' || /[\r\n\0]/.test(file.contentType))) return invalid();
  if (file.cid !== undefined && (typeof file.cid !== 'string' || /[\r\n\0]/.test(file.cid))) return invalid();
  if (Buffer.isBuffer(file.content)) return file.content;
  return invalid(); // Never fingerprint a path, stream or remote URL instead of selected bytes.
}
export function reviewedEmailSenderRevision(tenant: string, provider: { providerId: string; providerType: string },
  settingsFingerprint: string, from: EmailAddress, replyTo?: EmailAddress): string {
  return digest({ tenant, providerId: provider.providerId, providerType: provider.providerType, settingsFingerprint,
    from: address(from), replyTo: replyTo ? address(replyTo) : null });
}
export function reviewedEmailMessageHash(message: EmailMessage): string {
  if (!message.to?.length || message.bcc?.length || typeof message.subject !== 'string' || /[\r\n\0]/.test(message.subject) ||
      (message.html !== undefined && typeof message.html !== 'string') || (message.text !== undefined && typeof message.text !== 'string')) return invalid();
  const headers = Object.entries(message.headers ?? {}).map(([key, value]) => {
    if (!/^[A-Za-z0-9-]+$/.test(key) || typeof value !== 'string' || /[\r\n\0]/.test(value)) return invalid();
    return [key.toLowerCase(), value];
  }).sort(([a], [b]) => a.localeCompare(b));
  if (new Set(headers.map(([key]) => key)).size !== headers.length) return invalid();
  return digest({ from: address(message.from), to: message.to.map(address), cc: (message.cc ?? []).map(address),
    replyTo: message.replyTo ? address(message.replyTo) : null, subject: message.subject, html: message.html ?? '', text: message.text ?? '',
    headers, attachments: (message.attachments ?? []).map(file => ({ filename: file.filename, contentType: file.contentType ?? null,
      cid: file.cid ?? null, hash: createHash('sha256').update(fileBytes(file)).digest('hex') })) });
}
export function previewReviewedEmail(message: EmailMessage, provider: { providerId: string; providerType: string }, senderRevision: string): ReviewedEmailPreview {
  const messageHash = reviewedEmailMessageHash(message);
  return { senderRevision, messageHash, providerId: provider.providerId, providerType: provider.providerType,
    from: address(message.from), replyTo: message.replyTo ? address(message.replyTo) : undefined,
    to: message.to.map(address), cc: (message.cc ?? []).map(address), subject: message.subject, html: message.html ?? '', text: message.text ?? '',
    files: (message.attachments ?? []).map(file => ({ filename: file.filename, contentType: file.contentType, size: fileBytes(file).length })) };
}

/** Freeze the rendered message before awaits. The caller supplies conversation
 * headers; legacy ticket-wide threading must never rewrite this exchange. */
export function snapshotReviewedEmailParams(input: import('./BaseEmailService').BaseEmailParams): import('./BaseEmailService').BaseEmailParams {
  if (!input || input.templateProcessor || input.threading !== 'conversation' || input.bcc?.length ||
      typeof input.subject !== 'string' || typeof input.html !== 'string' || typeof input.text !== 'string') return invalid();
  const normalize = (value: string | EmailAddress) => address(typeof value === 'string' ? { email: value } : value);
  const normalizeList = (value: string | string[] | EmailAddress | EmailAddress[]) => (Array.isArray(value) ? value : [value]).map(normalize);
  const headers = { ...input.headers };
  const messageId = Object.entries(headers).find(([key]) => key.toLowerCase() === 'message-id')?.[1];
  if (!messageId || !/^<[^<>\s@]+@[^<>\s@]+>$/.test(messageId)) return invalid();
  const snapshot = { ...input, to: normalizeList(input.to), cc: input.cc ? normalizeList(input.cc) : undefined,
    from: input.from ? normalize(input.from) : undefined, replyTo: input.replyTo ? normalize(input.replyTo) : undefined,
    headers, bcc: undefined, attachments: input.attachments?.map(file => ({ ...file, content: Buffer.from(fileBytes(file)) })),
    replyContext: input.replyContext ? { ...input.replyContext } : undefined,
    reviewed: input.reviewed ? { ...input.reviewed } : undefined };
  // Validate all content now; the effective sender is resolved by the service.
  reviewedEmailMessageHash({ ...snapshot, from: snapshot.from ?? { email: 'pending@sender.invalid' }, to: snapshot.to,
    subject: input.subject, html: input.html, text: input.text });
  return snapshot;
}
