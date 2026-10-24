/**
 * Shared inbound-header normalization for `EmailMessageDetails.headers`.
 *
 * Both the V1 (`unifiedInboundEmailQueueJobProcessor.ts`) and V2/durable
 * (`inboundEmailSourceStager.ts`) inbound paths parse the same raw MIME with
 * mailparser and must build the exact same header bag from it, because
 * downstream consumers depend on it for security decisions:
 *
 *   - `processInboundEmailInApp.ts` reads `headers['authentication-results']`
 *     to derive sender authentication (SPF/DKIM/DMARC alignment) that gates
 *     named-conversation reply admission.
 *   - `inboundNamedConversationEmail.ts` reads `headers['auto-submitted']` /
 *     `headers['precedence']` to suppress auto-replies.
 *   - The `x-resolved-original-sender*` names below are treated as proof of a
 *     *verified* mailing-list rewrite (see `isVerifiedListRewrite` in
 *     `processInboundEmailInApp.ts`), so they must never pass through from
 *     wire data unfiltered — only this module (after running the trust check
 *     in `resolveListRewriteSender`) may set them.
 *
 * `EmailMessageDetails.headers` is typed `Record<string, string>`
 * (`packages/types/src/interfaces/email.interfaces.ts`), not
 * `Record<string, string[]>`, so repeated headers (most importantly a
 * multi-hop `Authentication-Results`) are joined with `\n`, preserving wire
 * order. `verifySenderAuthentication` (see `./senderAuthVerification.ts`)
 * splits back on `\n` and only trusts `blocks[0]` — the first block found
 * when walking the header top-to-bottom.
 *
 * Trust rationale for "topmost wins": mailparser preserves the raw wire order
 * of repeated headers (verified empirically: for a message with two
 * `Authentication-Results` headers, both `parsed.headers.get(...)` and
 * `parsed.headerLines` return them in top-to-bottom physical order). Our
 * receiving MTA prepends its own `Authentication-Results` header on final
 * delivery, so the real verdict is always the first physical occurrence.
 * Anything an attacker stamps into the message before it reaches our MTA
 * necessarily lands *after* that prepended header in wire order, so it can
 * only occupy `blocks[1..]`, which `verifySenderAuthentication` ignores. This
 * module does not re-derive that trust boundary; it only preserves wire order
 * so the existing topmost-first rule keeps working.
 */

import { resolveListRewriteSender, type ListRewriteResolution } from './listRewriteSender';

export interface ResolvedInboundHeaders {
  /** Lower-cased header bag, `undefined` when the message had no headers. */
  headers: Record<string, string> | undefined;
  /** Non-null when a trusted mailing-list rewrite was recovered. */
  listRewrite: ListRewriteResolution | null;
  /** The From address/name to use downstream — recovered author when a
   *  trusted list rewrite was found, otherwise the message's own From. */
  from: { email: string; name?: string };
}

/**
 * Build the downstream header bag and recover a trusted list-rewrite sender
 * from a mailparser `ParsedMail`. Must be called once per message and the
 * result reused everywhere `EmailMessageDetails.headers`/`.from` are set, so
 * V1 and V2 cannot silently drift again.
 */
export function resolveInboundHeaders(parsed: any): ResolvedInboundHeaders {
  const originalFrom = parsed?.from?.value?.[0];

  // Mailing-list / Google-Group DMARC rewrites replace the visible From with
  // the list address (e.g. "'Jane Doe' via support <support@lists.example.com>").
  // Recover the verified original author so downstream contact/watcher/notify
  // logic uses the real sender. Returns null for ordinary direct mail, or
  // when the recovered sender's Authentication-Results domain doesn't align.
  const listRewrite = resolveListRewriteSender(parsed);
  const fromEmail = listRewrite ? listRewrite.sender.email : (originalFrom?.address || '');
  const fromName = listRewrite
    ? (listRewrite.sender.name || originalFrom?.name || undefined)
    : (originalFrom?.name || undefined);

  const resolvedHeaders: Record<string, string> = {};
  // Preserve Authentication-Results from raw MIME for the sender-auth gate.
  // mailparser normalizes header names in its Map, while Gmail already
  // supplies a record via GmailAdapter.
  const parsedHeaders = parsed?.headers;
  if (parsedHeaders?.forEach) {
    parsedHeaders.forEach((value: unknown, key: string) => {
      const headerName = key.toLowerCase();
      // SECURITY: these names are processor metadata, never wire data. Drop
      // any incoming header using these names before anything else runs, so
      // an attacker cannot stamp e.g. `X-Resolved-Original-Sender` on their
      // own message and have it read back as a verified list rewrite below.
      // Only the verified listRewrite branch below may add them.
      if (headerName.startsWith('x-resolved-') || headerName.startsWith('x-list-')) {
        return;
      }
      if (typeof value === 'string') {
        resolvedHeaders[headerName] = value;
      } else if (Array.isArray(value)) {
        // Header order is wire order: the first Authentication-Results block
        // is our receiving MTA's topmost result. Preserve each block (joined
        // with \n, since EmailMessageDetails.headers is string-valued) for
        // the gate to split back apart and take blocks[0].
        resolvedHeaders[headerName] = value.filter((item): item is string => typeof item === 'string').join('\n');
      }
    });
  }
  if (listRewrite) {
    resolvedHeaders['x-list-address'] = listRewrite.listAddress;
    resolvedHeaders['x-resolved-original-sender'] = listRewrite.sender.email;
    resolvedHeaders['x-resolved-original-sender-via'] = listRewrite.via;
  }

  return {
    headers: Object.keys(resolvedHeaders).length ? resolvedHeaders : undefined,
    listRewrite,
    from: { email: fromEmail, name: fromName },
  };
}
