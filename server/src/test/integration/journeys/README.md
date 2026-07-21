# Journey tests

A journey test walks one workflow the way a user actually does — across every
action, table, and background seam on the route — and asserts the money and
state at the end. The bricks (per-action integration tests) prove each step
works in isolation; journeys prove the steps still connect. They exist because
150+ green brick files once coexisted with a broken top flow: volume disguised
the gap.

Every file here runs in Tier-1 (the directory is a `tier1.manifest.json`
entry), so a broken journey blocks PRs.

## The journeys

### `contractWizardToInvoice`
Client with billing cycles and tax config → contract wizard with the optional
fields filled (PO required/number/amount, proration, end date, two fixed
services, 25000¢ base rate) → assignment carries the PO → recurring-period
sync → `generateInvoice` for the cycle.
Pins: wizard numbers land on the invoice exactly (subtotal, tax arithmetic,
charges sum to base rate); charge details carry the arrears service period the
money is for. Fixed lines bill **arrears** by default — the line starts a
month before the billed cycle, or the cycle window is empty.

### `ticketTimeApprovalToBilling`
Ticket for a client → tech logs a 2h entry against it on an hourly contract →
real `submitTimeSheet` → real `approveTimeSheet` → invoice.
Pins: the engine **refuses the whole invoice** while any entry in the window
is unapproved ("Blocked until approval"); after approval the hours bill at the
`service_prices` rate (currency-tagged; the legacy `default_rate` column is
deliberately ignored); the entry flips to `invoiced` + `APPROVED`.

### `inboundEmailToTicketReply`
Inbound email → new ticket (sender-matched contact, provider-default board) →
second email on the same thread becomes a comment, not a duplicate ticket →
agent reply goes out (transport mocked at the provider level, everything above
it real) → customer's reply to *our* notification threads back onto the same
ticket.
Pins: threading headers (`In-Reply-To`/`References`/stamped `Message-ID`),
reply-token persistence, `email_sending_logs` round-trip into inbound
matching. Final invariant: one ticket, four comments.

### `invoiceLifecycleToPayment`
Generated draft invoice → payment against a draft is refused → `finalizeInvoice`
→ partial external payment → closing payment.
Pins: status machine `draft → sent → partially_applied → paid`, balance-due
arithmetic, `invoice_payments` ledger and `payment` transactions reconciling to
the total. External payment recording is EE functionality: `invoice_payments`
is created only by the EE migration chain, and the alternative-payments
webhook is edition-gated. The CE test bootstrap never creates the table, so
the test mirrors the EE schema locally (`ensureInvoicePaymentsTable`) to
exercise the service-level seam.

### `invoiceRenderToDelivery`
Finalized invoice → `createPDFGenerationService` renders it through the real
pipeline (standard template AST shipped by the migrations → server-rendered
HTML → headless Chromium print via puppeteer) → real local storage →
`external_files` row → `DOCUMENT_GENERATED` workflow event.
Pins: the bytes are a structurally complete PDF (`%PDF-` header, xref
trailer, >2KB); the invoice number lands in the rendered HTML (no PDF
text-extraction dependency is usable in the runner — `pdf-lib` is stubbed to
`empty-module` in `vitest.config.ts` — so the pin sits on the same template-AST
evaluation that feeds the print); the stored row is tenant-scoped and invisible
from another tenant's scope; the file↔invoice linkage is the event payload
plus the invoice-number-derived `original_name` — this path writes **no**
`documents`/`document_associations` row; a re-render always stores a
brand-new file and row (no versioning or reuse; the service's `version` option
is accepted but never read). The only mocked seam is the event-bus publisher,
so the linkage payload can be asserted instead of disappearing into Redis.

### `portalServiceRequestToTicket`
Client-portal user submits a published service-request form → the ticket-only
execution provider creates the ticket at submit time (`created_ticket_id`
links them) → MSP lists/triages/replies → portal user sees the status change
and reply.
Pins: the client/contact chain on both records, and the scoping negative — a
sibling client's portal user gets empty lists and "access denied" on the same
tenant.

## Known gap: email delivery of rendered invoices

`invoiceRenderToDelivery` closes the render-and-store half of the old PDF gap:
a real Chromium-rendered PDF, the `external_files` row, tenant scoping, and
the `DOCUMENT_GENERATED` linkage event are all journey-covered. Still
uncovered above that seam: emailing the PDF. `sendInvoiceEmailAction` and the
invoice email job handler — recipient resolution (billing contact →
billing_email → location email), the Handlebars invoice-email template, and
the attachment round-trip through `StorageService.downloadFile` — have only
unit-level coverage with mocked PDFs.

## Running locally

The worktree's dev databases are not suitable (ports collide across worktrees
and passwords drift). Mirror CI with throwaway containers:

```bash
docker run -d --name journeys-pg -p 5499:5432 -e POSTGRES_USER=postgres \
  -e POSTGRES_PASSWORD=test_password -e POSTGRES_DB=postgres ankane/pgvector:latest
docker run -d --name journeys-redis -p 6390:6379 redis:7-alpine

cd server && TZ=UTC SECRET_FS_BASE_PATH=/nonexistent \
  DB_HOST=localhost DB_PORT=5499 DB_USER_ADMIN=postgres DB_PASSWORD_ADMIN=test_password \
  DB_USER_SERVER=app_user DB_PASSWORD_SERVER=test_password \
  APP_ENV=test NODE_ENV=test REQUIRE_DB=1 \
  REAL_REDIS=1 REDIS_HOST=localhost REDIS_PORT=6390 \
  npx vitest run src/test/integration/journeys/
```

`TZ=UTC` is load-bearing: local-midnight timestamps shift invoice windows and
break period matching. `SECRET_FS_BASE_PATH=/nonexistent` keeps the repo's
`secrets/` directory from overriding the env credentials (CI has no secrets
directory; this makes local behave the same).

## Adding a journey

Copy the structure of `contractWizardToInvoice` (mock preamble, bootstrap,
dynamic imports after mocks). The catalog and build order live in the testing
plan: P0 (this directory) is done; P1 is projects, scheduling, SLA,
quote→contract, client onboarding; P2 is imports, docs/KB, workflows,
notifications, assets, tenant onboarding, auth. Two rules earned the hard way:
actions frequently *return* `{ actionError }` objects instead of throwing, and
scheduling actions import `withAuth` from the `@alga-psa/auth` barrel — mock
both the barrel and the subpath, keeping `getCurrentUser` a `vi.fn`. A third,
from `invoiceRenderToDelivery`: when a mocked module is called from package
code (not server code), the mock factory's closure does not reliably share
module-scope state with the test body — a capture array stays empty even
though the mock records the call. Assert through the mock's own `mock.calls`
instead of a closure-captured array.
