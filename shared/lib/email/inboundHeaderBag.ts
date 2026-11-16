/**
 * Shared inbound-header normalization for `EmailMessageDetails.headers`.
 *
 * Both the V1 (`unifiedInboundEmailQueueJobProcessor.ts`) and V2/durable
 * (`inboundEmailSourceStager.ts`) inbound paths parse the same raw MIME with
 * mailparser and must build the same header data from it. This module is the
 * only place that turns a mailparser `ParsedMail` into header data, via one
 * entry point (`resolveInboundHeaders`) that exposes two deliberately separate
 * views:
 *
 * 1. Downstream bag (`buildInboundHeaderBag`) -> `EmailMessageDetails.headers`.
 *    Lower-cased names, repeated headers joined with `\n` in wire order
 *    (the type is `Record<string, string>`). Consumers:
 *      - `verifySenderAuthentication` splits `authentication-results` back on
 *        `\n` and trusts only `blocks[0]`, the topmost block.
 *      - `isMicrosoftIntraOrgSender` and automated-message / loop detection.
 *
 * 2. Topmost bag (`buildTopmostHeaderBag`) -> list-rewrite trust check only.
 *    The FIRST occurrence of each header wins (raw `headerLines`, falling back
 *    to the parsed Map).
 *
 * SECURITY: the list-rewrite trust check (`authResultsTrustDomain` in
 * `listRewriteSender.ts`) scans everything in its bag for an aligned pass. It
 * is only safe because that bag holds the topmost `Authentication-Results`,
 * the one stamped by our own receiving MTA. Anything an attacker adds before
 * the message reaches us lands BELOW it in wire order. If the trust check were
 * fed the `\n`-joined downstream bag, a forged lower block such as
 * `dmarc=pass header.from=evil.example` would vouch for a forged
 * `X-Original-Sender: ceo@evil.example`. Never merge the two views.
 *
 * `x-resolved-*` and `x-list-*` are processor metadata, never wire data. They
 * are stripped from the wire data before recovery runs, and only a verified
 * list-rewrite recovery may set them (they are read back as proof of a
 * verified rewrite by `isVerifiedListRewrite` in `processInboundEmailInApp.ts`).
 */

import { parseEmailAddress, type ParsedEmailAddress } from './addressUtils';
import {
  computeListRewriteSender,
  type HeaderBag,
  type ListRewriteResolution,
} from './listRewriteSender';

const ENV_FLAG = 'INBOUND_RESOLVE_LIST_ORIGINAL_SENDER';

function isFeatureEnabled(): boolean {
  return (process.env[ENV_FLAG] || 'true').toLowerCase() !== 'false';
}

function isProcessorMetadataHeader(lowerName: string): boolean {
  return lowerName.startsWith('x-resolved-') || lowerName.startsWith('x-list-');
}

/**
 * Downstream bag from the mailparser `parsed.headers` Map. String values are
 * kept as-is, string[] values (repeated headers) are `\n`-joined in wire order,
 * structured values (from/to/...) are dropped.
 */
export function buildInboundHeaderBag(parsed: any): Record<string, string> {
  const bag: Record<string, string> = {};
  const parsedHeaders = parsed?.headers;
  if (parsedHeaders?.forEach) {
    parsedHeaders.forEach((value: unknown, key: string) => {
      const headerName = key.toLowerCase();
      if (isProcessorMetadataHeader(headerName)) {
        return;
      }
      if (typeof value === 'string') {
        bag[headerName] = value;
      } else if (Array.isArray(value)) {
        bag[headerName] = value.filter((item): item is string => typeof item === 'string').join('\n');
      }
    });
  }
  return bag;
}

/**
 * Trust bag for list-rewrite recovery. Prefers `headerLines` (raw,
 * order-preserving) so the topmost Authentication-Results (added by our own
 * MX) wins; falls back to the parsed `headers` Map. Wire `x-resolved-*` /
 * `x-list-*` are dropped.
 */
export function buildTopmostHeaderBag(parsed: any): HeaderBag {
  const bag: HeaderBag = {};

  const lines: Array<{ key?: string; line?: string }> | undefined = parsed?.headerLines;
  if (Array.isArray(lines)) {
    for (const entry of lines) {
      const key = typeof entry?.key === 'string' ? entry.key.toLowerCase() : '';
      const line = typeof entry?.line === 'string' ? entry.line : '';
      if (!key || key in bag || isProcessorMetadataHeader(key)) {
        // Keep the first occurrence (topmost header): Authentication-Results is
        // prepended by the final MTA.
        continue;
      }
      const colon = line.indexOf(':');
      bag[key] = colon >= 0 ? line.slice(colon + 1).trim() : '';
    }
    return bag;
  }

  const map: Map<string, unknown> | undefined = parsed?.headers;
  if (map && typeof map.forEach === 'function') {
    map.forEach((value: unknown, key: string) => {
      const lower = key.toLowerCase();
      if (isProcessorMetadataHeader(lower)) {
        return;
      }
      if (typeof value === 'string') {
        bag[lower] = value;
      } else if (value && typeof value === 'object' && 'text' in (value as any)) {
        bag[lower] = String((value as any).text ?? '');
      } else if (value != null) {
        bag[lower] = String(value);
      }
    });
  }

  return bag;
}

/**
 * Resolve the original sender from a mailparser `ParsedMail`, honouring the
 * feature flag. Returns null when disabled, when the message is not a list
 * rewrite, or when the recovered sender cannot be trusted.
 */
export function resolveListRewriteSender(parsed: any): ListRewriteResolution | null {
  if (!isFeatureEnabled()) {
    return null;
  }

  const fromValue = parsed?.from?.value?.[0];
  const from: ParsedEmailAddress | null = fromValue?.address
    ? { email: String(fromValue.address).toLowerCase(), name: fromValue.name || undefined }
    : parseEmailAddress(parsed?.from?.text);

  return computeListRewriteSender(buildTopmostHeaderBag(parsed), from);
}

export interface ResolvedInboundHeaders {
  /** Lower-cased downstream bag; `undefined` when empty. */
  headers: Record<string, string> | undefined;
  /** Non-null when a trusted mailing-list rewrite was recovered. */
  listRewrite: ListRewriteResolution | null;
  /** Recovered author when a trusted list rewrite was found, else the parsed From. */
  from: { email: string; name?: string };
}

/**
 * Build the downstream header bag and recover a trusted list-rewrite sender.
 * Call once per message and reuse the result for both
 * `EmailMessageDetails.headers` and `.from`.
 */
export function resolveInboundHeaders(parsed: any): ResolvedInboundHeaders {
  const originalFrom = parsed?.from?.value?.[0];
  const listRewrite = resolveListRewriteSender(parsed);

  const headers = buildInboundHeaderBag(parsed);
  if (listRewrite) {
    headers['x-list-address'] = listRewrite.listAddress;
    headers['x-resolved-original-sender'] = listRewrite.sender.email;
    headers['x-resolved-original-sender-via'] = listRewrite.via;
  }

  return {
    headers: Object.keys(headers).length ? headers : undefined,
    listRewrite,
    from: {
      email: listRewrite ? listRewrite.sender.email : (originalFrom?.address || ''),
      name: listRewrite
        ? (listRewrite.sender.name || originalFrom?.name || undefined)
        : (originalFrom?.name || undefined),
    },
  };
}
