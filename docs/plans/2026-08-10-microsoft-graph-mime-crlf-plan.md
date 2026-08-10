# Microsoft Graph MIME CRLF correctness

**Branch:** `fix/graph-mime-crlf`
**Date:** 2026-08-10
**Status:** Design complete; no product or test code implemented

## Outcome

Compile Microsoft Graph MIME messages with RFC-standard CRLF line endings by
changing Nodemailer's stream transport from `newline: 'unix'` to the explicit
CRLF setting, `newline: 'windows'`. This is a MIME serialization boundary fix,
not a content or delivery-path redesign.

The fix must retain the existing reason for the MIME path: it carries branded
From display names and headers that the Graph JSON message shape cannot safely
preserve. It must also retain Reply-To, Message-ID, In-Reply-To, References,
automated-message headers, attachments, and CID inline images. SMTP delivery,
Graph JSON delivery, tenant templates, and the Graph adapter's POST contract are
outside the change.

## Problem and confirmed code path

`packages/email/src/providers/MicrosoftGraphEmailProvider.ts` owns two distinct
Graph send paths:

- `buildSendPayload()` returns Graph JSON for messages that do not require a
  branded From display name or non-`X-` headers.
- Messages that need the richer wire representation go through
  `buildMimeMessage()`, are compiled by a buffered Nodemailer stream transport,
  base64 encoded, and passed to `MicrosoftGraphAdapter.sendMail()` as
  `{ kind: 'mime', content }`.

The stream transport is currently configured with `newline: 'unix'`. That
option makes Nodemailer normalize the entire generated RFC message to bare LF,
including quoted-printable soft line breaks (`=\n`). Exchange expects the MIME
line boundary to be CRLF and can misdecode those soft breaks, producing visible
equals signs, dropped characters, corrupted UTF-8, exposed hidden reply
markers, and damaged long HTML/logo attributes.

Direct inspection of the installed Nodemailer implementation confirms that its
stream transport maps `newline: 'windows'` to its CRLF transform and
`newline: 'unix'` to its LF transform. A local compilation probe using long
quoted-printable HTML produced these results:

| Stream option | CRLF pairs | Bare LF | QP `=\r\n` | QP `=\n` |
| --- | ---: | ---: | ---: | ---: |
| omitted | 27 | 0 | 7 | 0 |
| `unix` | 0 | 27 | 0 | 7 |
| `windows` | 27 | 0 | 7 | 0 |

`shared/services/email/providers/MicrosoftGraphAdapter.ts` does not decode or
rewrite the MIME. It posts the base64 string to the configured mailbox's
`/sendMail` endpoint with `Content-Type: text/plain`. No adapter change is
needed.

## Chosen approach and alternatives

### Chosen: explicitly force CRLF in the MIME transport

Change the Nodemailer transport option in
`packages/email/src/providers/MicrosoftGraphEmailProvider.ts` from
`newline: 'unix'` to `newline: 'windows'`. “Windows” is Nodemailer's option name
for CRLF serialization; the choice is about the RFC wire format, not the host
operating system.

This is the smallest deterministic fix at the boundary that creates the
invalid bytes. Nodemailer continues to own header folding, multipart
boundaries, quoted-printable encoding, base64 encoding, and binary attachment
handling, while the provider states its wire-format requirement explicitly.

### Alternative: remove the explicit newline option

With the installed Nodemailer version, omitting `newline` currently leaves the
composer's native CRLF output intact, so deleting the override would also repair
the observed message. Reject this option because the RFC requirement would be
implicit in Nodemailer's current defaults. An explicit CRLF option better
documents and tests the Graph MIME boundary and is the same one-line scope.

### Alternative: rewrite the generated Buffer after compilation

Do not replace LF bytes after `sendMail()` returns. A broad byte rewrite would
operate on an already assembled multipart document and could alter encoded or
binary body regions, mishandle mixed CRLF/LF input, or conceal a future MIME
compiler regression. There is no evidence that Nodemailer's supported CRLF
mode is insufficient, so post-generation mutation adds risk without benefit.

Do not switch threaded messages to Graph JSON and do not modify tenant
templates. Those approaches would lose required identity/threading behavior or
push a transport defect into unrelated content.

## Implementation plan

### 1. Correct the MIME serialization boundary

File: `packages/email/src/providers/MicrosoftGraphEmailProvider.ts`

1. Set the existing buffered stream transport's `newline` option to
   `'windows'`.
2. Leave `streamTransport: true`, `buffer: true`, MIME selection in
   `buildSendPayload()`, mail option mapping in `buildMimeMessage()`, and base64
   conversion unchanged.
3. Do not add a second normalization pass or change exception handling. The
   existing guard that requires `result.message` to be a Buffer remains the
   failure boundary.

### 2. Add a wire-format and semantic regression test

Files:

- `packages/email/src/providers/__tests__/MicrosoftGraphEmailProvider.test.ts`
- `packages/email/package.json`
- `package-lock.json`

Add `mailparser` and its types as package-local development dependencies,
matching repository versions, rather than relying on workspace hoisting. Use
`simpleParser` in the provider test to validate the complete MIME document as a
recipient parser would. Configure it with `skipImageLinks: true` so it does not
replace CID URLs with data URLs before the exact-HTML assertion.

Extend the existing MIME behavioral coverage with one representative message
that deliberately forces quoted-printable wrapping and header folding:

- long inline-styled HTML;
- the production-shaped hidden `data-alga-reply-token`, ticket/comment ID, and
  `data-alga-reply-boundary` elements;
- a long CID logo reference plus a matching inline image attachment;
- a separate ordinary attachment with known bytes;
- the UTF-8 middle dot (`·`) in both HTML and plain text;
- a branded From display name and the configured mailbox address;
- named Reply-To;
- Message-ID, In-Reply-To, and a long multi-value References header;
- `Auto-Submitted: auto-generated` and
  `X-Auto-Response-Suppress: OOF, AutoReply, AutoForward`.

After the mocked adapter captures the MIME payload:

1. Decode `payload.content` from base64 to the raw RFC message Buffer.
2. Assert the message contains CRLF, every LF byte is immediately preceded by
   CR, and there are no bare LF bytes anywhere. Include a fixture long enough
   to prove a quoted-printable soft wrap exists as `=\r\n`, and assert no
   `=\n` soft wrap exists without the preceding CR.
3. Parse the raw Buffer with
   `simpleParser(rawMime, { skipImageLinks: true })` and assert the decoded
   `.html` and `.text` exactly equal the original inputs. This
   checks that transfer decoding restores the entire inline style, hidden ALGA
   marker, long logo CID, and UTF-8 middle dot rather than merely finding
   selected substrings.
4. Assert parsed sender address/display name, Reply-To, recipients, subject,
   Message-ID, In-Reply-To, ordered References values, and automated-message
   headers.
5. Assert both attachments retain filename, content type, disposition/CID as
   applicable, and byte-for-byte content.

Retain the existing nameless/headerless Graph JSON test unchanged as a branch
guard. Retain the existing MIME branding and threading assertions unless the
new behavioral test cleanly subsumes only redundant string checks. Do not
modify SMTP provider tests or Graph adapter tests: their unchanged suites serve
as regression evidence that routing and transport contracts did not move.

Avoid assertions on generated MIME boundary strings, Date, exact header-fold
positions, or whether Nodemailer selects quoted-printable versus base64 for
content generally. Those are library implementation details; line-ending
validity and decoded semantics are the contract.

## Error and risk handling

- The change introduces no new runtime branch and no fallback that could send a
  partially rewritten message. Existing initialization, authorization,
  attachment-size, adapter retry, and provider-error behavior remains intact.
- Explicit CRLF normalization applies only to the Graph MIME compiler. SMTP
  continues to use its own transport normalization, and Graph JSON never enters
  this compiler.
- Tests inspect bytes before Graph receives them. This isolates the producer
  invariant and prevents a tolerant parser from hiding bare-LF output.
- Parsing is a second, semantic assertion rather than a substitute for the raw
  byte check. `skipImageLinks` is required to keep mailparser's convenience CID
  rewriting from making correct HTML appear different.
- Attachment and inline-image bytes are asserted after parsing because this is
  the content most likely to be endangered by an overly broad rewrite. The
  chosen transport option lets Nodemailer normalize framing without a provider
  touching completed MIME bytes.

## Verification and smoke plan

Run from the repository root:

1. Focused provider regression:
   `npm -w packages/email test -- src/providers/__tests__/MicrosoftGraphEmailProvider.test.ts`
2. Full email package suite:
   `npm -w packages/email test`
3. Package typecheck:
   `npm -w packages/email run typecheck`
4. Package build:
   `npm -w packages/email run build`
5. Relevant unchanged adapter contract test, if the shared package suite is not
   already part of CI (run from the `shared` directory so the shared Vitest
   config is picked up):
   `npx vitest run services/email/providers/__tests__/MicrosoftGraphAdapter.sendMail.test.ts`

The SMTP sink cannot reproduce this defect because SMTP transports normalize
line endings and therefore mask the invalid MIME producer. The current
Microsoft Graph emulator covers OAuth and inbound mailbox/subscription routes
but has no `/users/:mailbox/sendMail` endpoint, so it cannot establish Exchange
MIME acceptance or rendering. Expanding either emulator is not warranted for
this one-line boundary correction.

When a connected Microsoft 365 test mailbox is available, send the same
representative threaded/branded message through the real Graph MIME path to an
external recipient. Confirm in the received client and downloaded raw message
that:

- no equals signs or hidden ALGA marker are visible;
- the middle dot and surrounding UTF-8 text are intact;
- inline styling and the CID logo render correctly;
- ordinary and inline attachments open with their original bytes;
- From, Reply-To, Message-ID, In-Reply-To, References, and automated-message
  headers are present as expected;
- the raw source parses successfully and has no bare LF in the submitted MIME
  framing (allowing for documented server-side reserialization when comparing
  the received copy).

If real Graph credentials are unavailable, disclose that the smoke is limited
to the wire-level fallback: the provider unit test validates the exact
pre-POST MIME bytes and transfer-decoded content, while the adapter unit test
validates that the base64 body is posted unchanged with Graph's required
content type. This gives strong producer/adapter coverage but does not claim to
prove Exchange acceptance or client rendering.

## Acceptance criteria

- Graph MIME messages generated by the provider contain CRLF line endings and
  zero bare LF bytes, including quoted-printable soft wraps.
- Parsing and transfer-decoding the representative message reproduces the
  exact original HTML and plain text, including long inline markup, hidden ALGA
  reply markers, the CID logo reference, and the UTF-8 middle dot.
- Branded From, configured mailbox address, Reply-To, Message-ID, In-Reply-To,
  References, automated-message headers, recipients, attachments, and inline
  images survive generation and parsing.
- Existing Graph JSON behavior and selection remain unchanged.
- Existing SMTP behavior and the Graph adapter POST contract remain unchanged.
- No tenant template, MIME/JSON routing rule, or post-generation byte rewrite is
  introduced.
- Focused tests, the full email package suite, email package typecheck/build,
  and the relevant adapter test pass.
- A real connected Graph smoke passes when credentials are available; otherwise
  the handoff explicitly records the wire-parser fallback and its Exchange
  coverage limitation.
