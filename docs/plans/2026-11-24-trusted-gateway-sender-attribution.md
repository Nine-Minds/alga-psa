# Design — trusted inbound gateway for sender attribution (card 8cd86923)

Date: 2026-11-24
Card: Inbound email: contact match dropped behind message-rewriting gateways (Avanan / Check Point Harmony)
PSA: alga-2026-0003139 (PBNJ Consulting, Phill Hodgkinson)

## 1. Problem, stated precisely

`verifySenderAuthentication` (`shared/lib/email/senderAuthVerification.ts`) reads **only the first
(topmost) Authentication-Results block** and `allowsContactSenderAttribution` requires an aligned
`spf=pass` or `dkim=pass` in it. When a customer's inbound gateway (Avanan / Check Point Harmony)
rewrites the message, the receiving MTA (Microsoft 365) stamps a top block with `dkim=none` and
`dmarc=fail`; the gateway's own block and its ARC-Authentication-Results sit below it and carry
`spf=pass` / `dkim=pass header.d=domotz.com`. Alga therefore discards a genuine contact match,
falls back to the client's Default Contact, and adds the real sender as a watcher — which then also
receives the ticket-created email.

Two things are wrong:

1. **The parser has no concept of an authentication chain.** It picks one block and never asks who
   asserted it. A lower block is not ipso facto trustworthy either: any sender can write an
   `Authentication-Results` or `ARC-Authentication-Results` header into a message, so "read later
   blocks too" on its own would be a spoofing hole, not a fix.
2. **An unverified sender is still notified.** When the match is dropped for failed authentication,
   the address that failed is added to the watch list and mailed. A spoofed sender should not be
   told its ticket exists.

## 2. What the standards give us

- **RFC 8601** — each Authentication-Results block *names its own authserv-id* (`mx.avanan.net;
  spf=pass …`). The receiving MTA's block is authoritative for the hop it performed. Lower blocks are
  transit history and are forgeable.
- **RFC 8617 (ARC)** — a forwarder/gateway seals the chain it saw: `ARC-Authentication-Results`
  (sets, `i=` and authserv-id), `ARC-Message-Signature`, `ARC-Seal` with a chain validation result
  `cv=pass|fail|none`. A seal is a DKIM-style signature over the chain, verifiable against the
  sealing domain's DNS key. **This is the only mechanism by which a downstream party can prove that
  a header set was actually asserted by an earlier hop.**

So the general mechanism is: *parse the whole chain, then decide which hop's assertion we are willing
to believe, on stated evidence.*

## 3. Decision

Introduce a **per-inbox trusted-gateway policy** and an **authentication-chain evaluator**. Trust is
conferred only by evidence the gateway cannot be impersonated into providing.

### 3.1 New pure module — `shared/lib/email/authResultsChain.ts`

```
type AuthServBlock = { authservId: string | null; raw: string; results: SenderAuthResults };
type ArcSet        = { instance: number; authservId: string | null; results: SenderAuthResults };

parseAuthenticationResults(values: string | string[]): AuthServBlock[]   // all blocks, in header order
parseArcAuthenticationResults(rawHeaders): ArcSet[]                      // i= ordering, comments stripped
evaluateContactAttribution({
  blocks, arcSets, arcSeal,            // arcSeal = { cv: 'pass'|'fail'|'none', sealingAuthservId }
  fromEmail,
  policy: { trustedAuthservIds: string[]; mode: 'off' | 'arc-sealed' | 'mta-arc-pass' },
}): { trusted: boolean; source: 'mta' | 'gateway-arc' | 'mta-arc-pass' | 'none'; reason: string }
```

- Existing behaviour is preserved by construction: `verifySenderAuthentication()` becomes
  `parseAuthenticationResults(values)[0]` (same first-block semantics, same comment stripping,
  same domain alignment helpers — they move into the new module and are re-exported).
- Alignment is always recomputed **per block against the From domain**, never taken from the block's
  own `header.from` claim alone.

### 3.2 Trust rules (contact attribution only)

In order:
1. **`mta`** — the topmost block has an aligned `spf=pass` or `dkim=pass` (today's rule; unchanged).
2. **`gateway-arc`** (`mode: 'arc-sealed'`) — the ARC chain validates (`cv=pass`) **and** the sealing
   authserv-id is in the inbox's `trustedAuthservIds`; then the ARC set for that authserv-id shows an
   aligned `spf=pass`/`dkim=pass`. Seal validation is cryptographic verification of `ARC-Seal`
   against the sealing domain's DNS key with the raw RFC822 bytes.
3. **`mta-arc-pass`** (`mode: 'mta-arc-pass'`) — the receiving MTA's own block asserts `arc=pass`
   (i.e. *Microsoft validated the chain for us*). Cheaper, no crypto in Alga, but only works where the
   receiving MTA performs ARC validation. Offered as the fallback mode, not the default.
4. Otherwise `none` — the match is dropped exactly as today.

A bare lower `Authentication-Results` block is **never** sufficient, with or without configuration:
it is forgeable and the whole point of ARC is that a sealed header set is the provable artefact.

### 3.3 Configuration surface

Per **inbox** (the `email_providers` row, where the mailbox credentials and provider type already
live), not tenant-wide: a gateway protects one mailbox, and a tenant-wide switch would widen the
blast radius of a misconfiguration.

- `inbound_auth_trust jsonb` (or two typed columns):
  `{ "mode": "off" | "arc-sealed" | "mta-arc-pass", "trustedAuthservIds": ["mx.avanan.net"] }`
- Default `{ "mode": "off" }` → byte-identical behaviour for every existing tenant.
- UI: Email Settings → the provider/mailbox → "Trusted inbound gateway" (mode select + authserv-id
  list, with the explanation that this only affects contact attribution and never internal users).
  Tenant-scoped read/write through the existing tenant settings actions.

### 3.4 Where it is wired

`processInboundEmailInApp.ts` around line 1037: replace the two-value computation with

```
const chain = evaluateContactAttribution({ blocks, arcSets, arcSeal, fromEmail: senderEmail, policy });
const contactSenderTrusted = chain.trusted || isVerifiedListRewrite || isTrustedIntraOrgSender;
```

and log the deciding `source`/`reason` on the existing diagnostic line
(`sender auth not aligned; discarding contact match` gains `authSource`). Internal-user attribution
(`allowsInternalSenderAttribution`, `isMicrosoftIntraOrgSender`) is **untouched**: a gateway can never
confer an internal identity, and #4149's stricter internal path is not weakened.

### 3.5 The notification half — do not mail an unverified sender

`buildUnmatchedSenderWatchListRecipients` (~line 1255) adds the sender as a watcher; the ticket-created
mail then goes to the watcher. Rule: **when the contact match was dropped for failed authentication,
the sender is not added as a watcher** (nothing is lost — the message is still on the ticket as the
requester's original, and the From address is recorded in the message metadata). The Default Contact
remains the ticket contact and still receives the intended ticket-created notification; "nobody else"
in the card's expectation means the spoofable address, not the client's own Default Contact.

## 4. Raw MIME availability (feasibility check)

ARC seal verification needs the original bytes. `EmailProviderAdapter.downloadRawMessage()` returns
the full RFC822 source and `shared/services/email/inboundEmailSourceStager.ts` already stages that
raw MIME and keeps `sourceSha256`. So seal verification happens where the raw bytes are at hand
(staging/ingest) and its verdict travels as `arcSeal: {cv, sealingAuthservId}` into
`processInboundEmailInApp`. New dependency: `mailauth` (ARC + DKIM verification); it is the standard
library for this and avoids hand-rolling canonicalisation.

## 5. Tests

- Multi-block Authentication-Results, Phill's sample shape: top `dkim=none dmarc=fail`, lower
  `mx.avanan.net` block with `spf=pass` — with `mode: off` the match is still dropped (regression).
- Same sample with `mode: 'arc-sealed'`, trusted `mx.avanan.net`, valid seal → match kept, and the
  decision source is `gateway-arc`.
- Same ARC headers but an invalid/absent seal → dropped (forgery test).
- Forged lower block with no ARC at all → dropped even with the gateway configured.
- Trusted authserv-id present but the block's pass does not align with From → dropped.
- `mta-arc-pass`: top block asserts `arc=pass` → kept; without it → dropped.
- Internal sender via gateway → still refused (`allowsInternalSenderAttribution` path unchanged).
- Unverified sender: no watch-list addition, no outbound notification; Default Contact still notified.
- No configuration → full existing suite green (byte-identical behaviour).

## 6. Non-goals / deliberately not done

- No "skip authentication" switch. The card is explicit that the fix is narrower than that.
- No tenant-wide default and no silent auto-detection of a gateway.
- No change to `getSeatTrial…`-style unrelated surfaces; no change to inbound rules or duplicate
  handling.
- Not re-opening #4149's stricter internal-sender rules.

## 7. Risks

| Risk | Mitigation |
|---|---|
| A spoofed `ARC-Authentication-Results` with a trusted authserv-id | crypto seal verification is mandatory for `arc-sealed`; a bare block is never enough |
| Customer configures the wrong authserv-id and starts trusting an attacker's hop | UI copy + the seal still has to validate for that authserv-id; `off` by default |
| ARC libraries disagree on canonicalisation | verify with `mailauth` and assert Phill's real headers in tests |
| Dropping the watcher hides a legitimate sender's copy | the card's expectation; the address stays in the message metadata and on the ticket |
| #4149 regression | internal path untouched; explicit regression test |

## 8. Open questions for the captain

1. Is `arc-sealed` (crypto, correct) the only mode you want exposed, with `mta-arc-pass` kept internal
   for tenants whose MTA validates ARC? The design recommends exposing both but defaulting to off.
2. Confirm the notification rule in §3.5: an unverified sender is not notified at all, rather than
   notified with a differently-worded message.
