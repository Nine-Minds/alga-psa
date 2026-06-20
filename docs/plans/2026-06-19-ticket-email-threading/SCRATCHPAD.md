# SCRATCHPAD — Ticket Email Threading

## Working memory — discoveries, decisions, commands, gotchas

### Root-cause findings (verified in code)
- `packages/email/src/BaseEmailService.ts:407` — `Message-ID` set **only** when
  `replyContext.commentId` present. `:401` `addCommentThreadReplyHeaders()` only
  produces `In-Reply-To`/`References` for a comment thread. → non-comment events get
  no Alga Message-ID and no threading headers.
- Non-comment handlers pass `replyContext: { ticketId, threadId }` (no commentId):
  `server/src/lib/eventBus/subscribers/ticketEmailSubscriber.ts:1041`, `:1377`, `:1424`,
  `:1445`, `:1781`.
- Subjects diverge: updates hardcode `Ticket Updated: <title>` (`:1374`); created uses
  template subject; `Ticket #<number>` lives only in body meta-line (`:902`). No subject
  fallback for client grouping.
- References already appended to `tickets.email_metadata` at
  `server/src/lib/notifications/sendEventEmail.ts:478` — reuse this.
- `email_sending_logs` records `rfc_message_id`, `comment_thread_id`, `entity_type`/
  `entity_id`. SMTP provider passes `message.headers` (`SMTPEmailProvider.ts:260`);
  Resend forwards `payload.headers` (`ResendEmailProvider.ts:366`).
- Generated id domain is `*.alga-psa.local` (`buildGeneratedRfcMessageId`) — change to
  real sending domain.

### Decisions
- Anchor = ticket scope, one root Message-ID per ticket. Email-origin → inbound
  `email_metadata.messageId`; UI-origin → deterministic `<ticket-{ticketId}@{domain}>`.
- Scope = both audiences, full merge into customer's original thread.
- Storage = reuse `tickets.email_metadata`; no new tables. `comment_threads` retained
  for comment sub-threading.
- References cap = root + last 20.
- Sending domain = tenant configured domain → fallback single app domain.

### Inbound resolver note
- Inbound matching: reply token (primary) → `In-Reply-To`/`References` →
  `email_sending_logs.rfc_message_id` → comment thread / ticket. Required change: map a
  **ticket-entity** log row (`entity_type='ticket'`) back to the ticket, not only via
  `comment_thread_id`. Core logic in `shared/services/email/processInboundEmailInApp.ts`.

### Smoke-test rig (local)
- Topology: local `npm run dev` server on **:3048** (worktree
  `/home/robert/alga-copies/feature-email-threading`), infra in Docker project
  `alga-psa-local-test` (network `alga-psa-local-test_app-network`, from `~/alga-psa`).
- GreenMail (`docker-compose.imap-test.yaml`): SMTP 3025, IMAP 3143, HTTP 8080, user
  `imap_user:imap_pass`. IMAP service posts to
  `http://host.docker.internal:3048/api/email/webhooks/imap`.
- Shared secret in use for the rig: `IMAP_WEBHOOK_SECRET=alga-local-imap-dev-secret-2026`
  (added to `server/.env.local`; webhook 503s without it).
- Unified inbound queue consumer is a **separate** process —
  `npm run unified-inbound-email-consumer` from `server/`. Not started by `npm run dev`.
- Tenant `6d178771-ad9a-4d43-8809-83992745f8f9`; dev login `glinda@emeraldcity.oz`
  (password rotates each boot — read from server pane banner).
- psql via: `docker exec -e PGPASSWORD="$(cat ~/alga-psa/secrets/postgres_password)"
  alga-psa-local-test_postgres psql -U postgres -d server -c "..."`.
- Test email sender:
  `python3 ~/.claude/skills/alga-inbound-email-testing/scripts/send_test_email.py`.
- Read raw outbound headers from GreenMail (HTTP API on 8080 / IMAP 3143) to assert
  Message-ID/In-Reply-To/References.

### Gotchas
- `email_providers` starts empty in this env — an IMAP provider must be created
  (prefer UI; IMAP password is stored via encrypted secret provider).
- nodemailer: setting `headers['Message-ID']` vs the `messageId` option — verify it
  doesn't override/duplicate; recorded `rfc_message_id` must equal the on-wire id.
- Restarting the dev server rotates the seeded login password.

### Implementation notes (2026-06-19)
- `packages/email/src/BaseEmailService.ts`: added `applyTicketThreadHeaders` (ticket-scoped
  anchor + In-Reply-To/References for ANY ticket email), exported pure
  `buildTicketThreadHeaders`/`capReferences`, `extractDomainFromAddress`, and changed
  `buildGeneratedRfcMessageId` to take a real domain (from the From address). `sendEmail`
  now: computes `effectiveTicketId = replyContext.ticketId ?? (entityType==='ticket' ?
  entityId : undefined)`; if ticket → `applyTicketThreadHeaders`, else legacy
  `addCommentThreadReplyHeaders`; always stamps a Message-ID for ticket/comment emails;
  defaults `entityType='ticket'`/`entityId=ticketId` for logging.
- `server/src/lib/notifications/sendEventEmail.ts`: prepend `[Ticket #N]` via the new pure
  `ticketSubject.ts`; append the RFC id (`result.rfcMessageId ?? result.messageId`) to
  `email_metadata.references` (was `result.messageId`).
- `shared/services/email/processInboundEmailInApp.ts`: `resolveReplyTargetFromOutboundMessageId`
  now also matches `entity_type='ticket'` rows → returns the ticket (append at ticket level,
  no parent comment). Reply-token path stays primary.
- Unit tests pass: `ticketThreadHeaders.test.ts` (7), `ticketSubject.test.ts` (7). email +
  shared packages typecheck clean (server tsc OOMs — verify via dev server / vitest).

### Smoke-test prerequisites / gotchas (must resolve before driving the matrix)
- **Load the new code:** the dev server was restarted BEFORE these edits. `packages/email`
  is a built dep — rebuild it and restart the server (and the consumer, which loads
  `shared/` via tsx) so the running processes use the new threading code.
- **IMAP provider creds missing:** `imap_email_provider_config.last_error='IMAP credentials
  missing'` for provider `dc59ec87-e668-4e9b-99e9-ecf084e08238`. The email-service can't
  auth to GreenMail → inbound blocked until the IMAP password secret is stored (create via
  UI, or write the secret the email-service reads). Needed for the inbound round-trip (T003).
- **Outbound SMTP provider → GreenMail:** outbound emails go through the tenant's email
  provider (`tenant_email_settings` / `email_provider_configs`), NOT the inbound IMAP
  provider. To capture real outbound headers in GreenMail, configure a tenant SMTP provider
  pointing at GreenMail SMTP (`imap-test-server:3025` / `localhost:3025`). Without it,
  sendEmail returns "service disabled or not configured" and emails are skipped.
- **Read raw outbound headers** from GreenMail (IMAP 3143 or HTTP API on 8080) to assert
  Message-ID / In-Reply-To / References for T001/T002.

### Links
- Design: [../2026-06-19-ticket-email-threading-design.md](../2026-06-19-ticket-email-threading-design.md)
