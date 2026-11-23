import { simpleParser } from 'mailparser';
import { parseEmailAddress, type ParsedEmailAddress } from './addressUtils';
import { INBOUND_MIME_PARSE_OPTIONS } from '../../services/email/inboundMimeParseOptions';

/**
 * Recognising a forwarded message and recovering who originally sent it.
 *
 * One recogniser, two consumers:
 *  - `replyParser` uses `parseForwardedHeaderBlock` to decide where quoted history starts.
 *  - inbound ticket creation uses `detectForwardedSender` to pick the client-side contact when an
 *    authenticated internal user forwards a client's email.
 *
 * Safety model: the recovered address is unauthenticated text. Callers must only use it to choose a
 * contact/client, never to grant an identity, and only after the *forwarder* has been authenticated.
 * Evidence is limited to a nested message/rfc822 attachment and the first forward-header block in the
 * text part. Outer headers (X-Original-From, Reply-To, Sender, Return-Path, Authentication-Results)
 * are deliberately never read.
 */

const ENV_FLAG = 'INBOUND_RESOLVE_FORWARDED_SENDER';

export function isForwardedSenderResolutionEnabled(): boolean {
  return (process.env[ENV_FLAG] || 'true').toLowerCase() !== 'false';
}

export type ForwardedHeaderField = 'from' | 'sent' | 'to' | 'cc' | 'subject';

/**
 * Classify a plain-text quoted-message envelope line. Localised labels are covered
 * (From/De/Von, Sent/Date/Gesendet/Envoyé, To/An/À, Subject/Objet/Betreff).
 */
export function classifyForwardedHeaderField(line: string): ForwardedHeaderField | null {
  if (/^(?:from|de|von)\s*:/i.test(line)) return 'from';
  if (/^(?:sent|date|envoyé|gesendet)\s*:/i.test(line)) return 'sent';
  if (/^(?:to|an|à|répondre à)\s*:/i.test(line)) return 'to';
  if (/^cc\s*:/i.test(line)) return 'cc';
  if (/^(?:subject|betreff|objet)\s*:/i.test(line)) return 'subject';
  return null;
}

export interface ForwardedHeaderBlock {
  /** Raw (unfolded) values by field. */
  fields: Partial<Record<ForwardedHeaderField, string>>;
  /** Distinct email addresses found in the From value (lower-cased). */
  fromAddresses: string[];
  /** The From address when exactly one distinct address is present. */
  from?: ParsedEmailAddress;
  date?: string;
  subject?: string;
}

const ADDRESS_SCAN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;

/**
 * Parse a coherent plain-text forward/quoted envelope that starts at `startIndex`
 * (which must be its From line). Coherent means From + Sent/Date + To + Subject, so a stray
 * `From:` form field in an ordinary body is not mistaken for a forward. Returns null otherwise.
 * `from` is left undefined when the From value is unparseable or carries several addresses.
 */
export function parseForwardedHeaderBlock(lines: string[], startIndex = 0): ForwardedHeaderBlock | null {
  if (startIndex >= lines.length) return null;
  if (classifyForwardedHeaderField(lines[startIndex].trim()) !== 'from') return null;

  const fields: Partial<Record<ForwardedHeaderField, string>> = {};
  let current: ForwardedHeaderField | null = null;
  const endIndex = Math.min(lines.length, startIndex + 10);

  for (let i = startIndex; i < endIndex; i += 1) {
    const rawLine = lines[i];
    const line = rawLine.trim();
    if (!line) break;

    const field = classifyForwardedHeaderField(line);
    if (field) {
      current = field;
      const value = line.slice(line.indexOf(':') + 1).trim();
      // First occurrence wins; a repeated field is kept out of the way rather than merged.
      if (fields[field] === undefined) fields[field] = value;
      else current = null;
      continue;
    }

    // Permit folded header values, but stop as soon as normal body text begins.
    if (/^\s/.test(rawLine)) {
      if (current) fields[current] = `${fields[current] ?? ''} ${line}`.trim();
      continue;
    }
    break;
  }

  if (fields.from === undefined || fields.sent === undefined || fields.to === undefined || fields.subject === undefined) {
    return null;
  }

  const found = new Set<string>();
  for (const match of fields.from.match(ADDRESS_SCAN) ?? []) found.add(match.toLowerCase());
  const fromAddresses = [...found];

  let from: ParsedEmailAddress | undefined;
  if (fromAddresses.length === 1) {
    const parsedName = parseEmailAddress(fields.from)?.name;
    from = { email: fromAddresses[0], ...(parsedName ? { name: parsedName } : {}) };
  }

  return { fields, fromAddresses, from, date: fields.sent, subject: fields.subject };
}

export interface ForwardedAttachmentInput {
  contentType: string;
  /** base64 payload, as provided by the inbound adapters */
  content?: string;
  name?: string;
}

export interface DetectForwardedSenderInput {
  /** Accepted for call-site symmetry; intentionally never read as evidence. */
  headers?: Record<string, string>;
  text?: string | null;
  html?: string | null;
  attachments?: ForwardedAttachmentInput[] | null;
}

export type ForwardedSenderAnalysis =
  | { status: 'none' }
  | { status: 'attributed'; sender: ParsedEmailAddress; source: 'nested-message' | 'text-block' }
  | { status: 'not-applied'; reason: 'no-text-part' | 'ambiguous' };

const FORWARD_MARKER = /^(?:-{2,}\s*forwarded message\s*-{2,}|begin forwarded message:?|-{2,}\s*original message\s*-{2,})$/i;
const HTML_FORWARD_HINT = /forwarded message|begin forwarded message|original message|<b>\s*from:\s*<\/b>/i;

async function senderFromNestedMessages(
  attachments: ForwardedAttachmentInput[]
): Promise<ParsedEmailAddress | 'ambiguous' | null> {
  for (const attachment of attachments) {
    if (!/^message\/rfc822\b/i.test(attachment.contentType || '')) continue;
    if (!attachment.content) continue;
    try {
      const parsed = await simpleParser(Buffer.from(attachment.content, 'base64'), INBOUND_MIME_PARSE_OPTIONS);
      const values = parsed.from?.value ?? [];
      const distinct = new Set(values.map((v) => (v.address ?? '').toLowerCase()).filter(Boolean));
      if (distinct.size === 1) {
        const address = values.find((v) => v.address)!;
        return { email: address.address!.toLowerCase(), name: address.name || undefined };
      }
      return 'ambiguous';
    } catch {
      return 'ambiguous';
    }
  }
  return null;
}

/**
 * Analyse a new inbound message for a forwarded original sender, keeping enough detail
 * for callers to explain why a detected forward was not applied.
 */
export async function analyzeForwardedSender(input: DetectForwardedSenderInput): Promise<ForwardedSenderAnalysis> {
  const nested = await senderFromNestedMessages(input.attachments ?? []);
  if (nested === 'ambiguous') return { status: 'not-applied', reason: 'ambiguous' };
  if (nested) return { status: 'attributed', sender: nested, source: 'nested-message' };

  const text = (input.text ?? '').replace(/\r\n?/g, '\n');
  if (!text.trim()) {
    if (input.html && HTML_FORWARD_HINT.test(input.html)) {
      return { status: 'not-applied', reason: 'no-text-part' };
    }
    return { status: 'none' };
  }

  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i].trim();
    if (classifyForwardedHeaderField(line) !== 'from') continue;
    // First coherent block only. If it is present but ambiguous, stop: never fall through
    // to a later block (e.g. an older message deeper in a forwarded reply chain).
    const block = parseForwardedHeaderBlock(lines, i);
    if (!block) continue;
    if (!block.from) return { status: 'not-applied', reason: 'ambiguous' };
    return { status: 'attributed', sender: block.from, source: 'text-block' };
  }

  // A forward marker with no coherent envelope is detected but not attributable.
  if (lines.some((l) => FORWARD_MARKER.test(l.trim()))) {
    return { status: 'not-applied', reason: 'ambiguous' };
  }
  return { status: 'none' };
}

export async function detectForwardedSender(
  input: DetectForwardedSenderInput
): Promise<{ sender: ParsedEmailAddress; source: 'nested-message' | 'text-block' } | null> {
  const analysis = await analyzeForwardedSender(input);
  return analysis.status === 'attributed' ? { sender: analysis.sender, source: analysis.source } : null;
}
