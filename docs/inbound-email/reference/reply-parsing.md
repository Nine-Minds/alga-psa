# Reply Parsing and Outbound Markers

This reference outlines how inbound replies are parsed and how outbound notifications are prepared so that only the new message content is stored as a ticket comment.

## Outbound Markers

Every notification sent through `sendEventEmail` now includes reply-friendly markers:

- A hidden preheader `<div data-alga-preheader>` holding the first two visible lines of the rendered body (about 140 characters, cut at a word boundary, HTML-escaped; omitted when the body is empty). Mail clients use the first text of an HTML email as the inbox preview, so this keeps the preview showing the notification's content instead of the reply token or the boundary banner.
- A hidden, textless `<div>` element with `data-alga-reply-token`, `data-alga-ticket-id`, and related attributes so the parser can recover the originating entity, followed by a textless boundary `<div>`. These carry their data only in attributes and still come before all template content.
- A visible `--- Please reply above this line ---` banner. In the HTML part it is rendered **below** the message body; in the plain-text part it stays above the body.
- Plain-text footers (`[ALGA-REPLY-TOKEN …]`, `ALGA-TICKET-ID:…`, etc.) appended to the text version to cover clients that strip HTML elements.

For full-document HTML templates, the hidden block (preheader, token, boundary, in that order) is inserted immediately after `<body …>` and the banner immediately before the closing `</body>`, so nothing is emitted after `</html>`. Template fragments get the hidden block prepended and the banner appended.

Replies still resolve without visible token text: the parser merges tokens from the HTML `data-*` attributes with the plain-text `[ALGA-REPLY-TOKEN …]` lines, and the inbound workflow falls back to `In-Reply-To`/`References`/thread id. An HTML-only reply whose client strips `data-*` attributes resolves by threading headers alone.

When a corresponding event provides a `replyContext`, a conversation token is generated, persisted to the `email_reply_tokens` table, and embedded into the outbound email. Tokens capture:

- `ticketId` or `projectId`
- Optional `commentId` (for comment notifications)
- Optional `threadId` for threading hints

The `email_reply_tokens` table keeps the mapping so the inbound workflow can resolve replies even if subjects or threading headers change.

## Parser Heuristics

`shared/lib/email/replyParser.ts` applies a layered set of heuristics:

1. **Preheader removal** – strips `data-alga-preheader` elements (nested-safe) before token extraction and trimming, so a reply that lost the boundary does not inherit the preview excerpt as comment text. Emails sent with the older layout (token text inside the hidden div, banner at the top) still parse unchanged.
2. **Explicit boundary** – trims at `--- Please reply above this line ---` or localized variants.
3. **Token stripping** – removes `[ALGA-REPLY-TOKEN …]` and ID footers from the sanitized body.
4. **Provider headers** – recognises Gmail (`On … wrote:`), Outlook quoting, Microsoft Graph forwarded headers, and drops quoted history.
5. **Quote filtering** – skips `>` prefixed lines while still allowing inline responses after quoted blocks.
6. **Signature trimming** – strips common signatures (`Thanks,`, `Best regards,`, `Sent from …`) within the trailing 12 lines.
7. **Fallback** – if everything is removed the original body is retained and flagged as low confidence.

The parser returns:

- Sanitized text/html
- Applied heuristics and warnings
- Extracted token metadata (conversation token, ticket/comment/project identifiers)
- Confidence level (`high`, `medium`, `low`)

Fixtures under `server/src/lib/email/__fixtures__/` cover Gmail top-posting, Outlook inline replies, forwarded chains, and signature-heavy responses. Vitest inline snapshots describe the sanitized output for each scenario.

## Inbound Workflow Integration

The workflow stores the parser result (`metadata.parser`) alongside the comment. When a reply arrives:

- If a conversation token is present, `find_ticket_by_reply_token` resolves the target ticket/comment before consulting threading headers.
- Low-confidence parses log a warning and include truncated raw bodies in the comment metadata for operator review.
- Attachments are processed exactly as before; trimming only affects the comment body.

## Provider Notes

| Provider | Behaviours handled | Key heuristics |
|----------|-------------------|----------------|
| Gmail    | Top-posted replies with `On … wrote:` headers, inline quoting, Mail API quoting markers | Boundary split, provider header detection, quote filtering |
| Outlook / Exchange | Prefixed `>` quoting, `_` separators, mobile signatures (`Sent from Outlook`) | Quote filtering, signature trimming |
| Microsoft Graph | Forwarded chains (`Forwarded message`), multilingual headers (`Envoyé :`, `De :`) | Localised header detection, forwarded header breakpoints |

These behaviours inform the regex lists in the parser so new providers can be added without rewriting workflow logic. Adjustments for additional locales can be made via `ReplyParserConfig` (see `getDefaultReplyParserConfig`).

## Configuration Surface

`getDefaultReplyParserConfig()` exposes the defaults. Consumers can supply overrides (alternate delimiter text, custom signature markers, etc.) when invoking the parser through `parse_email_reply`.

## Data Model Summary

```
email_reply_tokens
  tenant UUID (PK part)
  token TEXT (PK part)
  ticket_id UUID NULL
  project_id UUID NULL
  comment_id UUID NULL
  entity_type TEXT DEFAULT 'ticket'
  metadata JSONB
  template TEXT
  recipient_email TEXT
  created_at TIMESTAMP WITH TIME ZONE
  expires_at TIMESTAMP WITH TIME ZONE NULL
```

Rows expire manually (retention policy TBD). The workflow uses the mapping purely to locate the target record on inbound replies.
