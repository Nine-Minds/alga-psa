import { createHash } from 'node:crypto';

export const MAX_ATTACHMENT_BYTES = 100 * 1024 * 1024;
export const ORIGINAL_EMAIL_ATTACHMENT_ID = '__original_email_source__';

type ImageAttachmentSource = 'data-url' | 'cid';

export interface EmailAttachmentLike {
  id?: string;
  name?: string;
  contentType?: string;
  size?: number;
  contentId?: string;
  isInline?: boolean;
}

export interface SyntheticEmbeddedAttachment {
  id: string;
  name: string;
  contentType: string;
  size: number;
  content?: string;
  providerAttachmentId?: string;
  source: ImageAttachmentSource;
  allowInlineProcessing: true;
}

export interface EmbeddedExtractionResult {
  attachments: SyntheticEmbeddedAttachment[];
  warnings: string[];
}

function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

function normalizeContentId(input: string | undefined | null): string {
  if (!input) return '';
  return String(input)
    .trim()
    .replace(/^cid:/i, '')
    .replace(/^<|>$/g, '')
    .toLowerCase();
}

function estimateBase64DecodedSize(base64: string): number {
  const value = base64.replace(/\s+/g, '');
  if (!value) return 0;
  const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor((value.length * 3) / 4) - padding);
}

function isLikelyBase64(value: string): boolean {
  return /^[A-Za-z0-9+/=\s]+$/.test(value);
}

function extensionFromMime(contentType: string): string {
  const normalized = String(contentType || '').toLowerCase();
  const direct = normalized.replace(/^image\//, '');
  if (direct === 'jpeg') return 'jpg';
  if (direct === 'svg+xml') return 'svg';
  if (direct === 'x-icon') return 'ico';
  if (direct) return direct.replace(/[^a-z0-9]+/g, '') || 'bin';
  return 'bin';
}

export function sanitizeGeneratedFileName(input: string, fallback = 'attachment.bin'): string {
  const value = String(input || '')
    .replace(/[/\\]/g, '-')
    .replace(/[\u0000-\u001F\u007F]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (!value) return fallback;

  const collapsed = value.replace(/[^A-Za-z0-9._ -]+/g, '-').replace(/-+/g, '-');
  const withoutLeadingDots = collapsed.replace(/^\.+/, '');
  if (!withoutLeadingDots) return fallback;
  return withoutLeadingDots.slice(0, 220);
}

function messageIdForFileName(messageId: string): string {
  const trimmed = String(messageId || '').trim().replace(/^<|>$/g, '');
  const sanitized = trimmed
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return sanitized || 'unknown-message';
}

function extractDataImageUrls(html: string): Array<{ contentType: string; base64: string; index: number }> {
  const matches: Array<{ contentType: string; base64: string; index: number }> = [];
  const regex = /data:(image\/[a-z0-9.+-]+);base64,([a-z0-9+/=\s]+)/gim;
  let match: RegExpExecArray | null = null;
  while ((match = regex.exec(html)) !== null) {
    matches.push({
      contentType: match[1].toLowerCase(),
      base64: (match[2] || '').trim(),
      index: matches.length,
    });
  }
  return matches;
}

function extractReferencedCids(html: string): string[] {
  const values: string[] = [];
  const seen = new Set<string>();
  const regex = /\bcid:([^"'<>\s)]+)/gim;
  let match: RegExpExecArray | null = null;
  while ((match = regex.exec(html)) !== null) {
    const normalized = normalizeContentId(match[1]);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    values.push(normalized);
  }
  return values;
}

export function extractEmbeddedImageAttachments(input: {
  emailId: string;
  html?: string | null;
  attachments?: EmailAttachmentLike[] | null;
  maxBytes?: number;
}): EmbeddedExtractionResult {
  const html = String(input.html || '');
  const allAttachments = Array.isArray(input.attachments) ? input.attachments : [];
  const maxBytes = typeof input.maxBytes === 'number' ? input.maxBytes : MAX_ATTACHMENT_BYTES;
  const result: SyntheticEmbeddedAttachment[] = [];
  const warnings: string[] = [];

  if (!html) {
    return { attachments: result, warnings };
  }

  const dataUrls = extractDataImageUrls(html);
  for (const entry of dataUrls) {
    if (!entry.contentType.startsWith('image/')) {
      warnings.push(`skipped_non_image_data_url:${entry.index}`);
      continue;
    }

    if (!entry.base64 || !isLikelyBase64(entry.base64)) {
      warnings.push(`skipped_invalid_data_url:${entry.index}`);
      continue;
    }

    const estimatedSize = estimateBase64DecodedSize(entry.base64);
    if (estimatedSize <= 0) {
      warnings.push(`skipped_empty_data_url:${entry.index}`);
      continue;
    }

    if (estimatedSize > maxBytes) {
      warnings.push(`skipped_oversize_data_url:${entry.index}`);
      continue;
    }

    const ext = extensionFromMime(entry.contentType);
    const deterministicHash = sha256(
      `${input.emailId}:data:${entry.index}:${entry.contentType}:${entry.base64}`
    ).slice(0, 24);
    result.push({
      id: `embedded-data-${deterministicHash}`,
      name: sanitizeGeneratedFileName(`embedded-image-${entry.index + 1}.${ext}`),
      contentType: entry.contentType,
      size: estimatedSize,
      content: entry.base64.replace(/\s+/g, ''),
      source: 'data-url',
      allowInlineProcessing: true,
    });
  }

  const referencedCids = extractReferencedCids(html);
  if (referencedCids.length > 0) {
    const attachmentByCid = new Map<string, EmailAttachmentLike>();
    for (const attachment of allAttachments) {
      const cid = normalizeContentId(attachment.contentId);
      if (!cid || attachmentByCid.has(cid)) continue;
      attachmentByCid.set(cid, attachment);
    }

    referencedCids.forEach((cid, index) => {
      const matched = attachmentByCid.get(cid);
      if (!matched) {
        warnings.push(`missing_cid_attachment:${cid}`);
        return;
      }

      const providerAttachmentId = matched.id ? String(matched.id) : '';
      if (!providerAttachmentId) {
        warnings.push(`cid_attachment_missing_id:${cid}`);
        return;
      }

      const contentType = String(matched.contentType || '').toLowerCase();
      if (!contentType.startsWith('image/')) {
        warnings.push(`skipped_non_image_cid:${cid}`);
        return;
      }

      const declaredSize = typeof matched.size === 'number' ? matched.size : 0;
      if (declaredSize > maxBytes) {
        warnings.push(`skipped_oversize_cid:${cid}`);
        return;
      }

      const ext = extensionFromMime(contentType);
      const deterministicHash = sha256(
        `${input.emailId}:cid:${cid}:${providerAttachmentId}`
      ).slice(0, 24);
      const preferredName = matched.name ? sanitizeGeneratedFileName(String(matched.name)) : '';
      const name = preferredName || sanitizeGeneratedFileName(`embedded-image-cid-${index + 1}.${ext}`);

      result.push({
        id: `embedded-cid-${deterministicHash}`,
        name,
        contentType,
        size: declaredSize,
        providerAttachmentId,
        source: 'cid',
        allowInlineProcessing: true,
      });
    });
  }

  return { attachments: result, warnings };
}

export function buildOriginalEmailFileName(messageId: string): string {
  const normalized = messageIdForFileName(messageId);
  return sanitizeGeneratedFileName(`original-email-${normalized}.eml`, 'original-email-unknown-message.eml');
}

function sanitizeHeaderValue(value: string | undefined | null): string {
  if (!value) return '';
  return String(value).replace(/[\r\n]+/g, ' ').trim();
}

function formatMailbox(mailbox: { email?: string; name?: string } | undefined): string {
  const email = sanitizeHeaderValue(mailbox?.email || '');
  const name = sanitizeHeaderValue(mailbox?.name || '');
  if (!email) return '';
  if (!name) return email;
  return `"${name.replace(/"/g, '\\"')}" <${email}>`;
}

function decodeMaybeBase64(input: string): Buffer | null {
  const value = String(input || '').trim();
  if (!value) return null;
  if (!isLikelyBase64(value)) return null;
  try {
    const buffer = Buffer.from(value, 'base64');
    return buffer.length > 0 ? buffer : null;
  } catch {
    return null;
  }
}

export function maybeExtractRawMimeFromEmailData(emailData: any): Buffer | null {
  if (!emailData || typeof emailData !== 'object') {
    return null;
  }

  const directRaw = typeof emailData.rawMime === 'string' ? emailData.rawMime : null;
  if (directRaw && directRaw.includes('\n')) {
    return Buffer.from(directRaw, 'utf8');
  }

  const base64Candidates = [
    emailData.rawMimeBase64,
    emailData.sourceMimeBase64,
    emailData.rawSourceBase64,
    emailData.mimeContentBase64,
  ];

  for (const candidate of base64Candidates) {
    if (typeof candidate !== 'string') continue;
    const buffer = decodeMaybeBase64(candidate);
    if (buffer) return buffer;
  }

  return null;
}

export function buildDeterministicRfc822Message(emailData: any): Buffer {
  const messageId = sanitizeHeaderValue(emailData?.id || `fallback-${sha256(JSON.stringify(emailData || {})).slice(0, 16)}`);
  const from = formatMailbox(emailData?.from) || 'unknown@example.invalid';
  const toList = Array.isArray(emailData?.to)
    ? emailData.to.map((entry: any) => formatMailbox(entry)).filter(Boolean)
    : [];
  const to = toList.length > 0 ? toList.join(', ') : 'undisclosed-recipients:;';
  const subject = sanitizeHeaderValue(emailData?.subject || '(no subject)');
  const receivedAt = sanitizeHeaderValue(emailData?.receivedAt || new Date(0).toISOString());
  const inReplyTo = sanitizeHeaderValue(emailData?.inReplyTo || '');
  const references = Array.isArray(emailData?.references)
    ? emailData.references.map((item: any) => sanitizeHeaderValue(String(item))).filter(Boolean).join(' ')
    : '';
  const textBody = String(emailData?.body?.text || '').replace(/\r?\n/g, '\r\n');
  const htmlBody = String(emailData?.body?.html || '').replace(/\r?\n/g, '\r\n');
  const boundary = `----alga-${sha256(`${messageId}:${subject}:${receivedAt}`).slice(0, 24)}`;

  const headers: string[] = [
    `Message-ID: <${messageId.replace(/^<|>$/g, '')}>`,
    `Date: ${receivedAt}`,
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${subject}`,
  ];

  if (inReplyTo) headers.push(`In-Reply-To: ${inReplyTo}`);
  if (references) headers.push(`References: ${references}`);

  headers.push('MIME-Version: 1.0');
  headers.push(`Content-Type: multipart/alternative; boundary="${boundary}"`);

  const parts: string[] = [];
  parts.push(`--${boundary}`);
  parts.push('Content-Type: text/plain; charset="utf-8"');
  parts.push('Content-Transfer-Encoding: 8bit');
  parts.push('');
  parts.push(textBody || subject || '(empty)');
  parts.push(`--${boundary}`);
  parts.push('Content-Type: text/html; charset="utf-8"');
  parts.push('Content-Transfer-Encoding: 8bit');
  parts.push('');
  parts.push(htmlBody || `<p>${textBody || subject || '(empty)'}</p>`);
  parts.push(`--${boundary}--`);

  const message = `${headers.join('\r\n')}\r\n\r\n${parts.join('\r\n')}\r\n`;
  return Buffer.from(message, 'utf8');
}
