export type ReplyParseConfidence = 'high' | 'medium' | 'low';
export type ReplyParsingStrategy =
  | 'custom-boundary'
  | 'provider-header'
  | 'quoted-block'
  | 'signature-trim'
  | 'fallback';

export interface ReplyTokenMetadata {
  conversationToken?: string;
  ticketId?: string;
  commentId?: string;
  threadId?: string;
  projectId?: string;
}

export interface ReplyParserInput {
  text: string;
  html?: string;
}

export interface ReplyParserConfig {
  /** Text markers that should be treated as the explicit reply delimiter. */
  replyDelimiters: string[];
  /** Attribute name injected into outbound HTML to mark the reply boundary. */
  htmlBoundaryAttribute: string;
  /** Prefix used for outbound hidden token attributes. */
  htmlTokenAttributePrefix: string;
  /** Pattern used to extract hidden reply tokens from plain text emails. */
  textTokenPattern: RegExp;
  /** Additional plain text markers for reply boundaries (localized variants). */
  localizedReplyPhrases: RegExp[];
  /** Providers emit headers like `On … wrote:` signalling quoted content. */
  providerReplyHeaders: RegExp[];
  /** Forwarded message markers that indicate legacy content. */
  forwardedReplyHeaders: RegExp[];
  /** Signature markers that typically separate the reply from signatures. */
  signatureMarkers: RegExp[];
  /** Maximum number of lines (from the bottom) to scan for signatures. */
  maxSignatureScanLines: number;
}

export interface ReplyParseResult {
  sanitizedText: string;
  sanitizedHtml?: string;
  confidence: ReplyParseConfidence;
  strategy: ReplyParsingStrategy;
  appliedHeuristics: string[];
  tokens: ReplyTokenMetadata | null;
  warnings: string[];
}

const DEFAULT_CONFIG: ReplyParserConfig = {
  replyDelimiters: [
    '--- Please reply above this line ---',
    'Please reply above this line',
    'Reply above this line',
    'Répondez au-dessus de cette ligne',
  ],
  htmlBoundaryAttribute: 'data-alga-reply-boundary',
  htmlTokenAttributePrefix: 'data-alga-',
  textTokenPattern: /\[ALGA-REPLY-TOKEN (?<token>[A-Z0-9:+\-_/]+)(?: ticketId=(?<ticket>[A-Za-z0-9\-]+))?(?: projectId=(?<project>[A-Za-z0-9\-]+))?(?: commentId=(?<comment>[A-Za-z0-9\-]+))?(?: threadId=(?<thread>[A-Za-z0-9\-]+))?\]/i,
  localizedReplyPhrases: [
    /répondez au-dessus de cette ligne/i,
    /responda acima desta linha/i,
    /antworten sie oberhalb dieser zeile/i,
  ],
  providerReplyHeaders: [
    /^on .+wrote:$/i,
    /^on .+ schrieb:.*/i,
    /^el .+ escribió:.*/i,
    /^le .+ a écrit :/i,
    /^am .+ schrieb .+/i,
    /^from:\s?.+/i,
    /^de:\s?.+/i,
    /^sent:\s?.+/i,
    /^envoyé :\s?.+/i,
    /^to:\s?.+/i,
    /^cc:\s?.+/i,
    /^subject:\s?.+/i,
    /^répondre à :\s?.+/i,
  ],
  forwardedReplyHeaders: [
    /^begin forwarded message/i,
    /^forwarded message/i,
    /^-----original message-----$/i,
  ],
  signatureMarkers: [
    /^--\s*$/, // Standard signature delimiter
    /^__+$/, // Outlook variant
    /^thanks[,]?$/i,
    /^thank you[,]?$/i,
    /^best[,]?$/i,
    /^best regards[,]?$/i,
    /^regards[,]?$/i,
    /^sent from my iphone/i,
    /^sent from my ipad/i,
    /^sent from my android/i,
    /^sent from outlook/i,
    /^sent from windows mail/i,
  ],
  maxSignatureScanLines: 12,
};

interface TrimResult {
  text: string;
  matched?: string;
  heuristic?: string;
}

type QuotedHeaderField = 'from' | 'sent' | 'to' | 'cc' | 'subject';

/**
 * Classify fields that commonly appear in a plain-text quoted-message envelope.
 * A single matching line is not enough evidence: structured email/form bodies
 * frequently contain legitimate fields such as `Subject:` or `From:`.
 */
function classifyQuotedHeaderField(line: string): QuotedHeaderField | null {
  if (/^(?:from|de)\s*:/i.test(line)) return 'from';
  if (/^(?:sent|date|envoyé)\s*:/i.test(line)) return 'sent';
  if (/^(?:to|répondre à)\s*:/i.test(line)) return 'to';
  if (/^cc\s*:/i.test(line)) return 'cc';
  if (/^subject\s*:/i.test(line)) return 'subject';
  return null;
}

/**
 * Recognize the coherent envelope emitted by plain-text Outlook-style replies.
 * Requiring From + Sent/Date + To + Subject avoids truncating authored content
 * merely because one form field happens to look like an email header.
 */
function isCoherentQuotedHeaderBlock(lines: string[], startIndex: number): boolean {
  if (classifyQuotedHeaderField(lines[startIndex].trim()) !== 'from') {
    return false;
  }

  const fields = new Set<QuotedHeaderField>();
  const endIndex = Math.min(lines.length, startIndex + 10);

  for (let i = startIndex; i < endIndex; i += 1) {
    const rawLine = lines[i];
    const line = rawLine.trim();
    if (!line) break;

    const field = classifyQuotedHeaderField(line);
    if (field) {
      fields.add(field);
      continue;
    }

    // Permit folded header values, but stop as soon as normal body text begins.
    if (/^\s/.test(rawLine)) continue;
    break;
  }

  return fields.has('from') && fields.has('sent') && fields.has('to') && fields.has('subject');
}

/** How many lines a provider attribution may wrap over before it stops looking like one. */
const MAX_WRAPPED_HEADER_LINES = 3;
/** Quoted lines a wrapped attribution must introduce: a whole quoted message, not one sentence. */
const MIN_WRAPPED_HEADER_QUOTED_LINES = 2;
/** The address a provider attribution names, which is what makes it wrap in the first place. */
const attributionAddressRegex = /[^\s<>@]+@[^\s<>@]+\.[A-Za-z]{2,}/;

/** Length of the quoted-line run starting at the first non-empty line from `startIndex`. */
function quotedLineRunLength(lines: string[], startIndex: number): number {
  let quoted = 0;

  for (let i = startIndex; i < lines.length; i += 1) {
    const line = lines[i].trim();
    if (!line) {
      if (quoted === 0) continue;
      break;
    }
    if (!line.startsWith('>')) break;
    quoted += 1;
  }

  return quoted;
}

/**
 * Gmail wraps a long `On <date> <Name> <addr> wrote:` attribution over two or three lines, so the
 * single-line `providerReplyHeaders` patterns miss it. An authored sentence can open with "On" and
 * introduce a quote of its own ("On Friday I spoke to the vendor. / He wrote: / > …"), and cutting
 * there destroys the text below it, so require what only a real attribution carries: the address
 * that forced the wrap, and the previous message — not a single line — quoted beneath.
 */
function isWrappedProviderReplyHeader(lines: string[], startIndex: number): boolean {
  if (!/^on\b/i.test(lines[startIndex].trim())) {
    return false;
  }

  const endIndex = Math.min(lines.length, startIndex + MAX_WRAPPED_HEADER_LINES);
  let run = lines[startIndex].trim();

  for (let i = startIndex + 1; i < endIndex; i += 1) {
    const line = lines[i].trim();
    if (!line) {
      return false;
    }
    run = `${run} ${line}`;
    if (!/wrote:$/i.test(line)) {
      continue;
    }
    return (
      attributionAddressRegex.test(run)
      && quotedLineRunLength(lines, i + 1) >= MIN_WRAPPED_HEADER_QUOTED_LINES
    );
  }

  return false;
}

const htmlCommentTokenRegex = /<!--\s*alga:reply-token:(?<payload>[^-]+)-->?/i;
const htmlTokenAttributeRegex = /data-alga-reply-token="(?<token>[^"]+)"/i;
const htmlTicketAttributeRegex = /data-alga-ticket-id="(?<ticket>[^"]+)"/i;
const htmlCommentAttributeRegex = /data-alga-comment-id="(?<comment>[^"]+)"/i;
const htmlProjectAttributeRegex = /data-alga-project-id="(?<project>[^"]+)"/i;
const htmlThreadAttributeRegex = /data-alga-thread-id="(?<thread>[^"]+)"/i;
const textTokenInlineRegex = /ALGA-REPLY-TOKEN:(?<token>[A-Z0-9:+\-_/]+)/i;
const textTicketInlineRegex = /ALGA-TICKET-ID:(?<ticket>[A-Za-z0-9\-]+)/i;
const textCommentInlineRegex = /ALGA-COMMENT-ID:(?<comment>[A-Za-z0-9\-]+)/i;
const textThreadInlineRegex = /ALGA-THREAD-ID:(?<thread>[A-Za-z0-9\-]+)/i;
const textProjectInlineRegex = /ALGA-PROJECT-ID:(?<project>[A-Za-z0-9\-]+)/i;

function stripTokenArtifacts(text: string, config: ReplyParserConfig): TrimResult {
  const lines = normalizeText(text).split('\n');
  const filtered = lines.filter((line) => {
    const trimmed = line.trim();
    if (!trimmed) {
      return true;
    }
    if (config.textTokenPattern.test(trimmed)) {
      return false;
    }
    if (/ALGA-REPLY-TOKEN[:\s]/i.test(trimmed)) {
      return false;
    }
    if (/ALGA-(TICKET|COMMENT|THREAD|PROJECT)-ID[:=]/i.test(trimmed)) {
      return false;
    }
    return true;
  });

  if (filtered.length !== lines.length) {
    return {
      text: filtered.join('\n').trim(),
      matched: 'token-artifact',
      heuristic: 'token-strip',
    };
  }

  return { text: text.trim() };
}

const NAMED_HTML_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

/** Normalize line endings and collapse stray carriage returns. */
function normalizeText(value: string): string {
  return value.replace(/\r\n?/g, '\n');
}

function decodeHtml(value: string): string {
  return value
    .replace(/&(#?)([xX]?)([0-9a-fA-F]+);/g, (match, isNumeric: string, hexMarker: string, body: string) => {
      if (!isNumeric) {
        const replacement = NAMED_HTML_ENTITIES[body.toLowerCase()];
        return replacement !== undefined ? replacement : match;
      }

      const parsed = hexMarker ? parseInt(body, 16) : parseInt(body, 10);
      if (Number.isFinite(parsed)) {
        return String.fromCodePoint(parsed);
      }
      return match;
    });
}

function trimAtExplicitDelimiter(text: string, config: ReplyParserConfig): TrimResult {
  const normalized = normalizeText(text);
  let bestIndex = -1;
  let matched: string | undefined;

  for (const delimiter of config.replyDelimiters) {
    const idx = normalized.toLowerCase().indexOf(delimiter.toLowerCase());
    if (idx >= 0 && (bestIndex === -1 || idx < bestIndex)) {
      bestIndex = idx;
      matched = delimiter;
    }
  }

  if (bestIndex >= 0) {
    return {
      text: normalized.slice(0, bestIndex).trim(),
      matched,
      heuristic: 'explicit-boundary',
    };
  }

  for (const localized of config.localizedReplyPhrases) {
    const match = localized.exec(normalized);
    if (match && (bestIndex === -1 || match.index < bestIndex)) {
      bestIndex = match.index;
      matched = match[0];
    }
  }

  if (bestIndex >= 0) {
    return {
      text: normalized.slice(0, bestIndex).trim(),
      matched,
      heuristic: 'localized-boundary',
    };
  }

  return { text: normalized };
}

/** Classes/ids that mail clients attach to quoted-history blockquotes. */
const KNOWN_QUOTE_MARKER_TOKENS = ['gmail_quote', 'yahoo_quoted', 'protonmail_quote', 'moz-cite-prefix'];

/** How much visible text before a blockquote to inspect for a provider reply header. */
const REPLY_HEADER_LOOKBEHIND_CHARS = 300;

/** Attribute marking the hidden inbox-preview excerpt Alga puts at the top of notification HTML. */
export const HTML_PREHEADER_ATTRIBUTE = 'data-alga-preheader';

/**
 * Remove every element carrying the preheader marker, content included. The excerpt
 * repeats text from the notification body, so it must never reach a parsed reply or
 * the visible-text view of one. Handles nested divs inside the marked element.
 */
export function stripPreheaderElements(html: string): string {
  const marker = new RegExp(`<([a-z][a-z0-9]*)\\b[^>]*\\b${HTML_PREHEADER_ATTRIBUTE}\\b[^>]*>`, 'i');
  let result = html;
  for (let match = marker.exec(result); match; match = marker.exec(result)) {
    const tag = match[1];
    const start = match.index;
    const tagRegex = new RegExp(`<(/?)${tag}\\b[^>]*>`, 'gi');
    tagRegex.lastIndex = start;
    let depth = 0;
    let end = result.length;
    for (let t = tagRegex.exec(result); t; t = tagRegex.exec(result)) {
      depth += t[1] ? -1 : 1;
      if (depth === 0) {
        end = t.index + t[0].length;
        break;
      }
    }
    result = result.slice(0, start) + result.slice(end);
  }
  return result;
}

/** Convert an HTML fragment to visible text, preserving block-level line breaks. */
export function htmlToVisibleText(html: string): string {
  const withBreaks = stripPreheaderElements(html)
    .replace(/<(?:style|script)\b[\s\S]*?<\/(?:style|script)>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(?:br|\/p|\/div|\/li|\/tr|\/h[1-6]|\/blockquote|\/table)\b[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ');
  return decodeHtml(withBreaks.replace(/&nbsp;/gi, ' '))
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .join('\n');
}

/**
 * Does the blockquote's opening tag carry a marker mail clients use for quoted history?
 * Outlook's `elementToProof` class is explicitly NOT such a marker: it appears on
 * blockquotes an author writes inline in a fresh message.
 */
function blockquoteTagIndicatesQuotedHistory(openTag: string): boolean {
  if (/\btype\s*=\s*["']?\s*cite\b/i.test(openTag)) {
    return true;
  }

  const attributeValues: string[] = [];
  for (const attribute of ['class', 'id']) {
    const match = new RegExp(`\\b${attribute}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(openTag);
    if (match) {
      attributeValues.push(match[1] ?? match[2] ?? match[3] ?? '');
    }
  }
  if (attributeValues.length === 0) {
    return false;
  }

  const combined = attributeValues.join(' ').toLowerCase();
  if (KNOWN_QUOTE_MARKER_TOKENS.some((token) => combined.includes(token))) {
    return true;
  }

  // Generic quote/cite markers, excluding Outlook's elementToProof (not a quote marker).
  const withoutElementToProof = combined.replace(/elementtoproof/gi, '');
  return /quote|cite/i.test(withoutElementToProof);
}

/** Does the visible text immediately preceding the blockquote end with a provider reply header? */
function endsWithProviderReplyHeader(prefixHtml: string, config: ReplyParserConfig): boolean {
  const visibleTail = htmlToVisibleText(prefixHtml).slice(-REPLY_HEADER_LOOKBEHIND_CHARS);
  const lines = visibleTail
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length === 0) {
    return false;
  }

  const lastLine = lines[lines.length - 1];
  return (
    config.providerReplyHeaders.some((regex) => regex.test(lastLine)) ||
    config.forwardedReplyHeaders.some((regex) => regex.test(lastLine))
  );
}

/**
 * Find the end index (just past `</blockquote>`) of the tag whose opening tag ends at
 * `afterOpenIndex`, depth-counting to handle nesting. Returns -1 when unclosed.
 */
function findMatchingBlockquoteCloseEnd(html: string, afterOpenIndex: number): number {
  const tokenRegex = /<\/?blockquote\b[^>]*>/gi;
  tokenRegex.lastIndex = afterOpenIndex;
  let depth = 1;
  let match: RegExpExecArray | null;
  while ((match = tokenRegex.exec(html)) !== null) {
    if (match[0].startsWith('</')) {
      depth -= 1;
      if (depth === 0) {
        return match.index + match[0].length;
      }
    } else {
      depth += 1;
    }
  }
  return -1;
}

/**
 * Substantive = non-whitespace visible text, ignoring a trailing signature block
 * (a suffix whose first visible line matches one of the configured signature markers).
 */
function hasSubstantiveVisibleText(suffixHtml: string, config: ReplyParserConfig): boolean {
  const lines = htmlToVisibleText(suffixHtml)
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length === 0) {
    return false;
  }
  return !config.signatureMarkers.some((regex) => regex.test(lines[0]));
}

interface QuotedHistoryTrimResult {
  html: string;
  removedQuote: boolean;
}

/**
 * Remove quoted reply history from an HTML body without destroying authored content.
 *
 * A blockquote is treated as quoted history only when at least one of these holds:
 * 1. its tag carries a known quote marker (`type="cite"`, gmail_quote, yahoo_quoted,
 *    protonmail_quote, moz-cite-prefix, or a generic quote/cite id/class — excluding
 *    Outlook's `elementToProof`);
 * 2. the visible text immediately before it ends with a provider reply header
 *    ("On … wrote:", "From:", "-----Original Message-----", …);
 * 3. it is trailing: after its matching close tag there is no substantive visible
 *    text (a trailing signature block does not count as substantive).
 *
 * Trailing history is cut off; a recognized quote span embedded mid-message is removed
 * without discarding the authored text that follows it. A blockquote that matches none
 * of the criteria (e.g. an author quoting something inline and continuing to write) is
 * kept untouched. Preserving too much is the safe failure mode.
 */
function trimQuotedHistoryBlockquotes(html: string, config: ReplyParserConfig): QuotedHistoryTrimResult {
  let result = html;
  let removedQuote = false;
  let searchFrom = 0;

  for (;;) {
    const openRegex = /<blockquote\b[^>]*>/gi;
    openRegex.lastIndex = searchFrom;
    const openMatch = openRegex.exec(result);
    if (!openMatch) {
      break;
    }

    const openIndex = openMatch.index;
    const openTag = openMatch[0];
    const closeEnd = findMatchingBlockquoteCloseEnd(result, openIndex + openTag.length);
    const recognizedQuote =
      blockquoteTagIndicatesQuotedHistory(openTag) ||
      endsWithProviderReplyHeader(result.slice(0, openIndex), config);
    const trailing = closeEnd === -1 || !hasSubstantiveVisibleText(result.slice(closeEnd), config);

    if (trailing) {
      result = result.slice(0, openIndex).trimEnd();
      removedQuote = true;
      break;
    }

    if (recognizedQuote) {
      // Embedded recognized quote span: drop the span, keep the authored suffix.
      result = result.slice(0, openIndex) + result.slice(closeEnd);
      removedQuote = true;
      searchFrom = openIndex;
      continue;
    }

    // Inline authored quote: keep it (and its contents) and keep scanning past it.
    searchFrom = closeEnd;
  }

  return { html: result, removedQuote };
}

function trimHtmlAtBoundary(html: string, config: ReplyParserConfig): TrimResult {
  const attributeIndex = html.toLowerCase().indexOf(config.htmlBoundaryAttribute.toLowerCase());

  if (attributeIndex >= 0) {
    // Cut before the marker's opening tag, not inside its attribute list.
    // Otherwise an HTML-only reply retains an incomplete `<div` or `<p`.
    const tagStart = html.lastIndexOf('<', attributeIndex);
    const boundaryStart = tagStart >= 0 && html.lastIndexOf('>', attributeIndex) < tagStart ? tagStart : attributeIndex;
    return {
      text: html.slice(0, boundaryStart).trim(),
      matched: config.htmlBoundaryAttribute,
      heuristic: 'html-boundary',
    };
  }

  // Fallback: remove blockquotes that actually look like quoted reply history.
  const blockquoteTrim = trimQuotedHistoryBlockquotes(html, config);
  if (blockquoteTrim.removedQuote) {
    return {
      text: blockquoteTrim.html.trim(),
      matched: '<blockquote',
      heuristic: 'html-blockquote-trim',
    };
  }

  // Last resort: our own markers as visible HTML. Notifications sent before the boundary
  // attribute existed carry the hidden token and the reply banner as ordinary nodes, and a
  // client that quotes in plain divs (Outlook, and Gmail for some mail) gives the HTML side
  // neither an attribute nor a blockquote to cut at. The text side cuts at the same marker,
  // so without this the HTML kept the whole quoted notification and, being preferred over
  // the text, was what the comment stored (alga-2026-0003353).
  const markerIndex = earliestMarkerIndex(html, config);
  if (markerIndex >= 0) {
    const tagStart = html.lastIndexOf('<', markerIndex);
    return {
      text: html.slice(0, tagStart >= 0 ? tagStart : markerIndex).trim(),
      matched: 'alga-reply-marker',
      heuristic: 'html-marker-boundary',
    };
  }

  return { text: html.trim() };
}

/**
 * Index of the first Alga reply marker (hidden token or reply banner) in an HTML body,
 * or -1. Only markers our own outbound mail writes, so authored content is never cut.
 */
function earliestMarkerIndex(html: string, config: ReplyParserConfig): number {
  const haystack = html.toLowerCase();
  const markers = ['[alga-reply-token', ...config.replyDelimiters.map((marker) => marker.toLowerCase())];
  return markers.reduce((earliest, marker) => {
    const index = haystack.indexOf(marker);
    if (index < 0) return earliest;
    return earliest < 0 ? index : Math.min(earliest, index);
  }, -1);
}

function stripProviderHeaders(text: string, config: ReplyParserConfig): TrimResult {
  const lines = normalizeText(text).split('\n');
  const kept: string[] = [];
  let matched: string | undefined;
  let heuristic: string | undefined;
  let removedQuoted = false;

  for (let i = 0; i < lines.length; i += 1) {
    const rawLine = lines[i];
    const line = rawLine.trim();

    if (!line && kept.length === 0) {
      continue;
    }

    if (config.forwardedReplyHeaders.some((regex) => regex.test(line))) {
      matched = line;
      heuristic = 'forwarded-header';
      break;
    }

    if (config.providerReplyHeaders.some((regex) => regex.test(line))) {
      const headerField = classifyQuotedHeaderField(line);
      if (headerField && !isCoherentQuotedHeaderBlock(lines, i)) {
        kept.push(rawLine);
        continue;
      }

      matched = line;
      heuristic = 'provider-header';
      break;
    }

    if (isWrappedProviderReplyHeader(lines, i)) {
      matched = line;
      heuristic = 'provider-header';
      break;
    }

    if (line.startsWith('>')) {
      removedQuoted = true;
      continue;
    }

    kept.push(rawLine);
  }

  const cleaned = kept.join('\n').trim();
  if (heuristic) {
    return { text: cleaned, matched, heuristic };
  }
  if (removedQuoted) {
    return { text: cleaned, matched: 'quoted-line', heuristic: 'quote-prefix' };
  }
  return { text: cleaned };
}

function stripSignature(text: string, config: ReplyParserConfig): TrimResult {
  const lines = normalizeText(text).split('\n');
  let cutoff: number | undefined;

  for (let i = lines.length - 1, scanned = 0; i >= 0 && scanned < config.maxSignatureScanLines; i -= 1, scanned += 1) {
    const line = lines[i].trim();
    if (!line) {
      continue;
    }
    if (config.signatureMarkers.some((regex) => regex.test(line))) {
      cutoff = i;
    }
  }

  if (cutoff !== undefined) {
    return {
      text: lines.slice(0, cutoff).join('\n').trim(),
      matched: 'signature',
      heuristic: 'signature-trim',
    };
  }

  return { text: text.trim() };
}

function compactWhitespace(text: string): string {
  return text
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function extractTokensFromHtml(html: string): ReplyTokenMetadata | null {
  const payload: ReplyTokenMetadata = {};
  const tokenMatch = htmlTokenAttributeRegex.exec(html) || htmlCommentTokenRegex.exec(html);
  if (tokenMatch?.groups?.token) {
    payload.conversationToken = tokenMatch.groups.token;
  } else if (tokenMatch?.groups?.payload) {
    payload.conversationToken = tokenMatch.groups.payload.trim();
  }

  const ticketMatch = htmlTicketAttributeRegex.exec(html);
  if (ticketMatch?.groups?.ticket) {
    payload.ticketId = ticketMatch.groups.ticket;
  }

  const commentMatch = htmlCommentAttributeRegex.exec(html);
  if (commentMatch?.groups?.comment) {
    payload.commentId = commentMatch.groups.comment;
  }

  const threadMatch = htmlThreadAttributeRegex.exec(html);
  if (threadMatch?.groups?.thread) {
    payload.threadId = threadMatch.groups.thread;
  }

  const projectMatch = htmlProjectAttributeRegex.exec(html);
  if (projectMatch?.groups?.project) {
    payload.projectId = projectMatch.groups.project;
  }

  return Object.keys(payload).length > 0 ? payload : null;
}

function extractTokensFromText(text: string, config: ReplyParserConfig): ReplyTokenMetadata | null {
  const payload: ReplyTokenMetadata = {};
  const normalized = normalizeText(text);

  let structuredMatch = config.textTokenPattern.exec(normalized);

  // Fallback: Attempt to recover multi-line tokens broken by email clients (e.g. Gmail wrapping + quoting)
  if (!structuredMatch) {
    const tokenStart = normalized.indexOf('[ALGA-REPLY-TOKEN');
    if (tokenStart >= 0) {
      // Grab a generous chunk to cover the full wrapped token
      const chunk = normalized.slice(tokenStart, tokenStart + 1000);
      // Remove newlines, '>' markers, and collapse extra spaces to reconstruct a single line
      const cleanChunk = chunk.replace(/[\r\n]+[\s>]*|>/g, ' ').replace(/\s+/g, ' ');
      structuredMatch = config.textTokenPattern.exec(cleanChunk);
    }
  }

  if (structuredMatch?.groups?.token) {
    payload.conversationToken = structuredMatch.groups.token;
    if (structuredMatch.groups.ticket) {
      payload.ticketId = structuredMatch.groups.ticket;
    }
    if (structuredMatch.groups.comment) {
      payload.commentId = structuredMatch.groups.comment;
    }
    if (structuredMatch.groups.thread) {
      payload.threadId = structuredMatch.groups.thread;
    }
    if (structuredMatch.groups.project) {
      payload.projectId = structuredMatch.groups.project;
    }
  }

  const inlineToken = textTokenInlineRegex.exec(normalized);
  if (inlineToken?.groups?.token) {
    payload.conversationToken = inlineToken.groups.token;
  }

  const inlineTicket = textTicketInlineRegex.exec(normalized);
  if (inlineTicket?.groups?.ticket) {
    payload.ticketId = inlineTicket.groups.ticket;
  }

  const inlineComment = textCommentInlineRegex.exec(normalized);
  if (inlineComment?.groups?.comment) {
    payload.commentId = inlineComment.groups.comment;
  }

  const inlineThread = textThreadInlineRegex.exec(normalized);
  if (inlineThread?.groups?.thread) {
    payload.threadId = inlineThread.groups.thread;
  }

  const inlineProject = textProjectInlineRegex.exec(normalized);
  if (inlineProject?.groups?.project) {
    payload.projectId = inlineProject.groups.project;
  }

  return Object.keys(payload).length > 0 ? payload : null;
}

function mergeTokenMetadata(primary: ReplyTokenMetadata | null, secondary: ReplyTokenMetadata | null): ReplyTokenMetadata | null {
  if (!primary && !secondary) {
    return null;
  }

  return {
    conversationToken: primary?.conversationToken || secondary?.conversationToken,
    ticketId: primary?.ticketId || secondary?.ticketId,
    commentId: primary?.commentId || secondary?.commentId,
    threadId: primary?.threadId || secondary?.threadId,
    projectId: primary?.projectId || secondary?.projectId,
  };
}

/**
 * Attempt to parse the inbound reply body using layered heuristics.
 */
export function parseEmailReply(input: ReplyParserInput, config: Partial<ReplyParserConfig> = {}): ReplyParseResult {
  const mergedConfig: ReplyParserConfig = { ...DEFAULT_CONFIG, ...config };
  const warnings: string[] = [];
  const appliedHeuristics: string[] = [];

  const originalText = input.text || '';
  const originalHtml = input.html ? stripPreheaderElements(input.html) : input.html;

  const htmlTokens = originalHtml ? extractTokensFromHtml(originalHtml) : null;
  const textTokens = extractTokensFromText(originalText, mergedConfig);
  const tokens = mergeTokenMetadata(htmlTokens, textTokens);

  // Step 1: explicit boundary trimming (text + html)
  let { text: trimmedText, matched: textBoundary, heuristic: textBoundaryHeuristic } = trimAtExplicitDelimiter(
    originalText,
    mergedConfig,
  );

  const tokenStrip = stripTokenArtifacts(trimmedText, mergedConfig);
  trimmedText = tokenStrip.text;
  if (tokenStrip.heuristic) {
    appliedHeuristics.push(tokenStrip.heuristic);
  }

  let trimmedHtmlResult: TrimResult | undefined;
  if (originalHtml) {
    trimmedHtmlResult = trimHtmlAtBoundary(originalHtml, mergedConfig);
  }

  if (textBoundaryHeuristic) {
    appliedHeuristics.push(textBoundaryHeuristic);
  }
  if (trimmedHtmlResult?.heuristic) {
    appliedHeuristics.push(trimmedHtmlResult.heuristic);
  }

  let strategy: ReplyParsingStrategy = textBoundary || trimmedHtmlResult?.matched ? 'custom-boundary' : 'fallback';
  let confidence: ReplyParseConfidence = strategy === 'custom-boundary' ? 'high' : 'low';

  // The explicit Alga boundary can sit several quote levels down (a reply to one's own reply
  // quotes a notification that is itself quoted), so the text above it still holds provider
  // attributions and quoted lines. Strip those too, but when the boundary already matched keep
  // the result only if authored text survives: an empty reply above the boundary must stay
  // empty, and ambiguous mail keeps preserving too much.
  const providerTrim = stripProviderHeaders(trimmedText, mergedConfig);
  if (providerTrim.heuristic && (!textBoundary || providerTrim.text.trim())) {
    trimmedText = providerTrim.text;
    appliedHeuristics.push(providerTrim.heuristic);
    if (!textBoundary) {
      strategy = providerTrim.heuristic === 'provider-header' ? 'provider-header' : 'quoted-block';
      confidence = confidence === 'high' ? 'high' : 'medium';
    }
  }

  const signatureTrim = stripSignature(trimmedText, mergedConfig);
  if (signatureTrim.heuristic) {
    trimmedText = signatureTrim.text;
    appliedHeuristics.push(signatureTrim.heuristic);
    strategy = strategy === 'fallback' ? 'signature-trim' : strategy;
    confidence = confidence === 'low' ? 'medium' : confidence;
  }

  trimmedText = compactWhitespace(trimmedText);
  const emptyAlgaReply = Boolean(
    tokens?.conversationToken && (textBoundary || tokenStrip.matched),
  );
  if (!trimmedText && !emptyAlgaReply) {
    // Preserve the fallback for ambiguous email, but never resurrect an Alga
    // notification after its reply boundary/token removal left no reply text.
    // The inbound processor uses this empty string to suppress comment creation.
    trimmedText = originalText.trim();
    if (!trimmedText) {
      warnings.push('Inbound email body was empty after parsing.');
    } else {
      warnings.push('Reply heuristics yielded empty body; using original text.');
    }
    strategy = 'fallback';
    confidence = tokens ? 'medium' : 'low';
  }

  let sanitizedHtml: string | undefined;
  if (originalHtml) {
    const baselineHtml = trimmedHtmlResult ? trimmedHtmlResult.text : originalHtml;
    // Attempt to keep html aligned with text heuristics by removing quoted history if none already removed
    if (!trimmedHtmlResult?.heuristic?.includes('blockquote')) {
      const blockquoteTrim = trimQuotedHistoryBlockquotes(baselineHtml, mergedConfig);
      if (blockquoteTrim.removedQuote) {
        sanitizedHtml = blockquoteTrim.html.trim();
        appliedHeuristics.push('html-blockquote-trim');
        if (strategy === 'fallback') {
          strategy = 'quoted-block';
          confidence = confidence === 'low' ? 'medium' : confidence;
        }
      } else {
        sanitizedHtml = baselineHtml.trim();
      }
    } else {
      sanitizedHtml = baselineHtml.trim();
    }

    // Remove common signature wrappers from HTML by trimming final paragraphs that match markers
    if (sanitizedHtml) {
      const signatureRegexes = mergedConfig.signatureMarkers
        .map((regex) => regex.source.replace(/^\^/, '').replace(/\$$/, ''))
        .join('|');
      const htmlSignatureRegex = new RegExp(
        `(<p[^>]*>\s*(?:${signatureRegexes})\s*<\/p>|<div[^>]*>\s*(?:${signatureRegexes})\s*<\/div>)`,
        'i',
      );
      sanitizedHtml = sanitizedHtml.replace(htmlSignatureRegex, '').trim();
    }

    // Safety net: if the blockquote cut removed a much larger share of the message than
    // the text heuristics did, the cut was likely a false positive — prefer the text
    // result so future misfires leak quoted history instead of destroying content.
    //
    // Compare like with like: the text side may still carry a quote level the HTML trim
    // already removed, so measure against the text with provider attributions and quoted
    // lines stripped. Otherwise a short reply above a long quote always trips the ratio.
    if (sanitizedHtml && appliedHeuristics.includes('html-blockquote-trim')) {
      const htmlVisibleLength = htmlToVisibleText(sanitizedHtml).replace(/\s+/g, ' ').trim().length;
      const baselineText = stripProviderHeaders(trimmedText, mergedConfig).text;
      const textLength = baselineText.replace(/\s+/g, ' ').trim().length;
      if (textLength > 0 && htmlVisibleLength < textLength * 0.5) {
        warnings.push(
          'HTML blockquote trim removed significantly more content than text heuristics; using text result.',
        );
        appliedHeuristics.push('html-trim-rejected');
        sanitizedHtml = undefined;
      }
    }

    if (!sanitizedHtml) {
      sanitizedHtml = undefined;
    }
  }

  if (tokens && confidence === 'low') {
    confidence = 'medium';
  }

  return {
    sanitizedText: decodeHtml(trimmedText),
    sanitizedHtml: sanitizedHtml ? decodeHtml(sanitizedHtml) : undefined,
    confidence,
    strategy,
    appliedHeuristics,
    tokens,
    warnings,
  };
}

export function getDefaultReplyParserConfig(): ReplyParserConfig {
  return { ...DEFAULT_CONFIG };
}
