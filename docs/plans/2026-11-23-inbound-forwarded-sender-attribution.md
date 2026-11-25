# Inbound email: attribute a technician's forwarded email to the original sender

Status: design for review · card `e407a6e9-342e-4fed-ad2b-52132f6ab3ff` · ticket alga-2026-0003178 (PBNJ Consulting Inc.)
Decided scope: Robert, 2026-11-15 (recorded in the card description).

## 1. Problem

A client (often a VIP) emails a technician directly. The technician forwards that message to the helpdesk
mailbox to open a ticket. Today the ticket follows internal-sender handling: routing defaults, the technician
stored as internal author, and **no contact/client attribution** — so the ticket is not filed under the client
who actually wrote it.

## 2. What today's pipeline already gets right

The pipeline is not missing an authentication story; it is missing a *content* reader.

- `verifySenderAuthentication` + `allowsInternalSenderAttribution` (`shared/lib/email/senderAuthVerification.ts:63,110`)
  already decide whether the **From** sender may be attributed. A technician mailing the helpdesk mailbox
  inside the same Microsoft 365 tenant passes via `isMicrosoftIntraOrgSender` (`:128`), and an external
  technician passes on aligned DMARC / SPF+DKIM.
- `resolveSenderContact` (`shared/services/email/processInboundEmailInApp.ts:1066-1099`) therefore already
  returns the forwarder as a matched **internal user**, gated. That is exactly the trust anchor this feature
  needs: *the forwarder is authenticated before we read anything they forwarded.*
- `resolveListRewriteSender` (`shared/lib/email/listRewriteSender.ts:249`) solves the sibling problem (mailing
  list rewrote the author) with the same shape: recover an author from content, but only behind an auth proof.
  It returns `null` for ordinary direct mail — which is why forwards are uncovered.

**So the security model does not need a new authentication check.** It needs one rule: *the recovered original
sender may only be used to choose a contact/client, never to grant an identity.*

## 3. Scope of the change (v1)

Applies to the **new-ticket** path only, and only when all of these hold:

1. the outer sender resolved as an **authenticated internal user** (the existing gate passed — both
   `allowsInternalSenderAttribution(...)` and `isMicrosoftIntraOrgSender(...)` qualify, exactly as today);
2. the message is recognisably a forward (nested `message/rfc822` attachment, or a forward-header block in the
   body);
3. exactly **one** original-sender address is recoverable;
4. that address resolves to a **contact that is not an internal user**, in this tenant;
5. no inbound rule has assigned the client.

Then: the ticket's `client_id`/`contact_id` are the original sender's, and the technician is stored as
`author_type='internal'` with their `author_id` (unchanged authorship). Otherwise: today's behaviour, byte for
byte.

Explicitly **not** in v1:
- **Reply/thread path** (`processInboundEmailInApp.ts:1387,1717`). A forward into an existing thread keeps the
  thread's contact; changing a thread's client mid-conversation is a different, riskier decision. Locked out by
  test.
- Contact-or-unknown forwarders. The original sender in a forward is unauthenticated text; honouring it from a
  non-internal forwarder would let anyone file one client's content under another client (scope rule 3).
- Contact-forwarding-on-behalf-of-contact (scope rule 4, deferred).
- HTML-only forward blocks. v1 reads the `text` part and nested messages; a forward with no text part is
  *detected* (metric) but not attributed. Adding an HTML-to-text extraction is a later, isolated change.
- Replying to the original sender / notification retargeting. Not asked for; the ticket's client is the only
  outcome.

## 4. Design

### 4.1 One forward recogniser, two consumers

`shared/lib/email/replyParser.ts:83-87` already recognises forward markers
(`begin forwarded message`, `forwarded message`, `-----original message-----`) and
`classifyQuotedHeaderField` (`:116-122`) already parses localised envelope fields (`From`/`De`, `Sent`/`Date`/`Envoyé`,
`To`, `Cc`, `Subject`). Today that knowledge is used only to *trim history*.

Extract the envelope scan into a new shared module and let both consumers use it:

```
shared/lib/email/forwardedMessage.ts
  parseForwardedHeaderBlock(lines: string[]): { from?: ParsedEmailAddress; date?: string; subject?: string } | null
  detectForwardedSender(input: {
    headers: Record<string, string>;
    text?: string | null;
    attachments?: Array<{ contentType: string; content?: string; name?: string }>;
  }): { sender: ParsedEmailAddress; source: 'nested-message' | 'text-block' } | null
```

`replyParser` keeps behaviour identical by calling `parseForwardedHeaderBlock` for its `forwarded-header`
heuristic instead of duplicating the regexes — the trimming rule and the attribution rule can then never drift.

Two sources, in precedence order:

1. **`nested-message`** — a `message/rfc822` (or `application/msg` later) attachment. This is structured
   message content, the strongest form: parse it with the existing `mailparser` `simpleParser` and
   `INBOUND_MIME_PARSE_OPTIONS` (`shared/services/email/inboundMimeParseOptions.ts:12`), take its `from`.
   (Today `message/rfc822` exists only as the archive content type, `processInboundEmailArtifact.ts:1404`;
   nothing parses it.)
2. **`text-block`** — the first forward-header block in the `text` part, parsed by
   `parseForwardedHeaderBlock`. The block must be *coherent* in the sense `isCoherentQuotedHeaderBlock`
   already encodes (From + Sent + To + Subject), and must yield exactly one address.

Rules that keep it deterministic and hard to spoof:

- **First block only.** Never scan the whole body for "any address that looks like a client" — that would let a
  forwarded *reply chain* choose an arbitrary client.
- **Header-derived values are never read for this.** The outer message's own `X-Original-From`,
  `Reply-To`, `Sender`, `Return-Path` and `Authentication-Results` are not evidence of a forwarded author.
  Only body content and nested messages are. (This is the reason the list-rewrite path cannot be reused
  wholesale: it reads headers.)
- **No internal promotion.** If the recovered address matches an internal user, discard it and fall back to
  today's behaviour. A forward may hand a *contact* to the app; it may never hand it an *identity*.
- **Ambiguity is failure.** Two different addresses in the block, or an unparseable From, means no attribution.
- **Env kill switch** in the house style (`INBOUND_RESOLVE_FORWARDED_SENDER`, default on, `!== 'false'`),
  mirroring `INBOUND_RESOLVE_LIST_ORIGINAL_SENDER` (`listRewriteSender.ts:46-50`).

### 4.2 Where the decision lands

Only `processInboundEmailInApp.ts` new-ticket branch changes, and only by inserting a *second* contact lookup:

```
// after resolveSenderContact returns an internal match and the internal gate passed
const forwarded = detectForwardedSender({ headers, text, attachments });       // §4.1
const forwardedContact = forwarded
  ? await findContactByEmail(forwarded.sender.email, tenant,
      { defaultClientId, ticketClientId: undefined, ticketContactId: undefined })
  : null;
const destinationContact = forwardedContact?.user_type !== 'internal' ? forwardedContact : null;
```

Then:

- `targetContactId` / `targetClientId` prefer `destinationContact` when there is no rule-assigned client,
  otherwise today's `defaults` resolution stands (`:2168-2234`).
- Authorship variables (`:2238-2246`) are **not** touched: `matchedSenderIsInternalUser` is already true, so
  `commentAuthorType='internal'`, `commentAuthorUserId` = technician, `commentAuthorContactId` = undefined.
- `client_id`/`contact_id` on ticket create (`:2362-2367`) get the destination values.

Two named variables, not one mutated one: `authorContact` (the forwarder — internal, unchanged) and
`destinationContact` (the client-side contact). Future authors must not conflate them; a comment on the pair
says why.

The reply/thread path stays untouched, and a test asserts it.

### 4.3 Attribution matrix (the specification)

| # | Forwarder | Original sender | Rule assigns client? | Result |
|---|---|---|---|---|
| 1 | authenticated internal | matches contact (client A) | no | ticket → client A / that contact; author internal = technician |
| 2 | authenticated internal | matches contact (client A) | yes (client B) | ticket → client B; attribution ignored (admin intent wins) |
| 3 | authenticated internal | no contact match | either | unchanged from today |
| 4 | authenticated internal | matches an **internal user** | — | unchanged from today (no internal promotion) |
| 5 | contact / unknown sender | matches any contact | — | unchanged from today (forwarder stays the contact) |
| 6 | From an internal address that **fails** the internal gate | matches contact | — | unchanged; no forward attribution, `logInboundSenderAuthFailure` as today |
| 7 | authenticated internal | two candidate addresses in the block | — | unchanged (ambiguity = failure) |
| 8 | authenticated internal, forward into an **existing thread** | matches contact | — | unchanged; thread contact wins (reply path locked) |

Rows 1–2 are the feature. Rows 3–8 are regression contracts.

## 5. Observability

- On attribution: log `inbound_email_forwarded_sender_attributed` with `tenant`, `source`
  (`nested-message` | `text-block`), `original_contact_id`, `client_id`, and the outer `sender` user id. Never
  log the address itself at info level.
- On *detected but not applied*: a counter/log `inbound_email_forwarded_sender_not_applied` with a reason
  (`no-text-part`, `ambiguous`, `no-contact-match`, `internal-match`, `rule-assigned-client`, `thread-path`).
  This is how coverage of the client formats gets measured instead of guessed.
- On a forward from a non-internal sender: nothing new (today's path already logs auth failures where relevant).

## 6. Docs

`docs/` user guide: in the inbound-email section, state that when a technician forwards a client's email to
the helpdesk mailbox, the ticket is created under that client and contact with the technician as internal
author; that only internal users' forwards are honoured; and that forwards to an existing thread keep the
thread's client.

## 7. Tests

Unit — `forwardedMessage.ts`:
- Outlook inline (`From: / Sent: / To: / Subject:`), Gmail (`---------- Forwarded message ---------`), Apple Mail
  (`Begin forwarded message:`), localised German/French envelope labels.
- nested `message/rfc822` (Outlook "Forward as Attachment") → inner `from` wins over any body block.
- direct mail with no forward markers → null.
- forwarded *reply chain*: only the first block is used.
- two different addresses in the block → null.
- outer message carrying `X-Original-From`/`Reply-To` pointing at a client, with no forward content → null
  (no header-based attribution).

Unit — `processInboundEmailInApp.ts` (extend the existing suite):
- row 1 of the matrix (new test), asserting `client_id`/`contact_id` are the forwarded contact's and the
  comment author stays `internal`.
- rows 2–8 as one test each, mostly asserting the existing expectations still hold.
- `replyParser` trimming tests unchanged (proves the extraction of the shared scanner did not regress trimming).

Integration — `inboundEmailInApp.webhooks.integration.test.ts`: Microsoft intra-org technician forwards a
Google-shaped client message → ticket under the client; Google contact forwards a message quoting another
client → forwarder stays the contact (row 5).

## 8. Risks

| Risk | Mitigation |
|---|---|
| Mis-filing content under the wrong client (cross-client disclosure) | internal-forwarder gate; contact must exist in this tenant; rule-assigned client wins; first-block-only; ambiguity = failure; no header evidence |
| Scope creep into identity | explicit "never internal" check, with its own test |
| Format drift across mail clients | one recogniser, two consumers; per-client unit tests; "detected but not applied" metric |
| Silent change to the thread path | reply path untouched and locked by test |
| Admin loses control of routing | explicit inbound rules always take precedence (§4.3 row 2) |

## 9. Open questions closed

- **PR #4149 (`authz in verifySenderAuthentication`, board card `c1c0473f`).** Build on today's gate. The
  forward feature consumes the *composite boolean* `allowsInternalSenderAttribution || isTrustedIntraOrgSender`
  computed once, so if #4149 hardens that gate the feature inherits it automatically; waiting would couple this
  card to an unrelated security review. This is recorded as a fact on the card.
- **Which formats in v1.** Nested message + text-part forward blocks for Outlook, Gmail and Apple Mail
  (including localised envelope labels), per §3 and §4.1.

## 10. Rollout

Env kill switch (default on). No tenant setting in v1: the security preconditions are strict enough that the
behaviour is correct-by-construction for ordinary mail, and a tenant flag would make "live for PBNJ" depend on
a toggle nobody has asked to configure. If a customer reports surprising attribution, the kill switch and the
`not_applied` reason metric will localise it immediately.

## 11. Follow-up (outside this change)

Report back to Phill Hodgkinson (PBNJ Consulting Inc.) on ticket alga-2026-0003178 when this is live.
