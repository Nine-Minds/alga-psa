# Plan — Invoice branding on screen, refuse emailing voided invoices, copy payment link

Card `e598807e` · PSA ticket **alga-2026-0003016** · customer **Managed Nerds** (Sharon Martin), hosted
prod tenant `b9d9fac3-dec7-4fb3-ae89-80b9d17f2cd7`.

## Problem

Three defects reported together on 2026-10-22.

1. **Branding logo missing on every on-screen invoice view.** PR #3884 (`0da8c9db30`) made
   `fetchTenantParty` (`packages/billing/src/lib/adapters/tenantPartyAdapter.ts`) prefer the
   Settings → Branding logo and `pdfGenerationService.enrichWithTenantClient` already consumes it, so
   **PDFs are correct**. Two builders of the tenant party for screen rendering were never converted and
   still call `getClientDocumentLogoUrl` only:
   - `Invoice.getFullInvoiceById` → `tenantClient.logoUrl` (`packages/billing/src/models/invoice.ts` ~L683–L691)
   - `adaptToWasmViewModel` → `tenantClientInfo.logoUrl` (`packages/billing/src/actions/invoiceGeneration.ts` ~L2239)

   Everything that renders from `getInvoiceForRendering` inherits the bug: MSP invoice preview, the client
   portal invoice view (`client-billing.ts`, `BillingOverview.tsx`), and the designer preview of an existing
   invoice. The comment at `DesignerVisualWorkspace.tsx` ~L93 ("Existing invoices already carry real
   branding") is wrong and is part of the fix.

2. **Voided and paid invoices are emailed as if open.** Prod: `INV-26-10-000002` was voided at
   2026-10-22 04:07:36 and emailed at 04:10:41 (`email_sending_logs`). `isInvoiceLinkEligible` correctly
   omitted the pay link, which the customer experienced as "sometimes there is no payment link". Neither
   `sendInvoiceEmailAction` (`packages/billing/src/actions/invoiceJobActions.ts`) nor
   `InvoiceEmailHandler` (`server/src/lib/jobs/handlers/invoiceEmailHandler.ts`) looks at invoice status at
   all — the MSP send action logs it, nothing gates on it.

3. **No MSP-side way to get the payment link.** The durable `/pay/<token>` URL
   (`buildDurablePaymentUrl`, `packages/billing/src/lib/payments/invoicePaymentUrls.ts`) exists only inside
   the invoice email. The MSP has to send a real email to a real customer to obtain a link they may only
   want to paste into a chat.

## Decisions

**D1 — One tenant-party rule, one implementation.** `fetchTenantParty` is already that rule
(`branding.logoWideUrl || branding.logoUrl` → client document logo → null). Both screen builders call it and
stop calling `getClientDocumentLogoUrl` *for the tenant party*. The rule is not re-implemented, and no new
helper is introduced. The separate `logo` field on the invoice view model (`invoice.ts` ~L577 / ~L754) is the
**client's** logo for a different party and stays exactly as it is.

**D2 — Delete the duplicated tenant lookup.** `adaptToWasmViewModel` hand-queries `tenant_companies` +
`clients` + `client_locations` to get the name/address, which is precisely what the adapter does. Replace the
whole block with `fetchTenantParty`. One visible consequence, recorded deliberately: the pre-generation
preview's tenant address now uses the adapter's preferred-location ordering (billing address, then default)
instead of taking a lone `address_line1`. That is the intended unification — it must be asserted by a test
and named in the PR body, not discovered in review.

**D3 — The server refuses cancelled invoices; it does not ask.** Guard in **both** `sendInvoiceEmailAction`
and `InvoiceEmailHandler`: a job can be queued without passing through the action, so the handler is the last
gate and needs the same rule. Result is typed (`{ ok: false, reason: 'invoice-cancelled' }`) with a sentence
the MSP can read, and the dialog renders that sentence rather than a generic failure. Refusal rather than a
"send anyway?" confirmation: a voided invoice documents nothing, and every legitimate resend case is served
by a credit note or a reissue. No override flag — a "force" mode is a policy decision the card does not ask
for.

**D4 — A paid invoice sends as a receipt, and says so.** Sending stays allowed, but the send path labels the
message (receipt subject/template variant, invoice stated as paid in the body) and the dialog says
"This invoice is paid — the email will be sent as a paid receipt." Nothing else about the paid path changes;
the pay link is already omitted by `isInvoiceLinkEligible`.

**D5 — Copy payment link reuses the email's eligibility, not a new rule.** New action
`getInvoicePaymentLinkAction` returns `{ url }` or `{ reason }`, built from `isInvoiceLinkEligible` +
`isInvoiceOnlinePaymentAllowed` and `buildDurablePaymentUrl(tenant, invoiceId, <tenant payment-link
lifetime>)` — the same construction, token type and lifetime as the email. What the MSP copies is exactly
what the customer would have received, and an ineligible invoice gets the reason instead of a link. No new
URL shape, no new token type, no second eligibility check.

**D6 — Existing surfaces only.** "Copy payment link" goes in `InvoicePreviewPanel` and the preview drawer,
with the existing `navigator.clipboard` + toast pattern already used in settings. No new dialog, no new
modal, no new component unless the panel's layout forces one.

## Shapes

| File | Change |
| --- | --- |
| `packages/billing/src/models/invoice.ts` | `getFullInvoiceById`: tenant party from `fetchTenantParty` (replaces the `getClientDocumentLogoUrl` call at ~L683). Import at L29 stays — it still serves the client logo at L577. |
| `packages/billing/src/actions/invoiceGeneration.ts` | `adaptToWasmViewModel` (~L2205–L2245): drop the inline tenant query, use `fetchTenantParty`. |
| `packages/billing/src/actions/invoiceJobActions.ts` | Status guard at the top of `sendInvoiceEmailAction`, before PDF generation; paid-receipt labelling where subject/template is chosen. |
| `server/src/lib/jobs/handlers/invoiceEmailHandler.ts` | Same cancelled guard at the point status is already read for the job detail record. |
| `packages/billing/src/actions/invoicePaymentLinkActions.ts` *(new)* | `getInvoicePaymentLinkAction`. Action module — keeps `invoiceEmailLinkContext`/`invoicePaymentUrls` worker-safe. |
| `.../invoicing/InvoicePreviewPanel.tsx`, `InvoicePreviewDrawerContent.tsx` | Copy-payment-link control + inline ineligible reason. |
| `.../invoicing/SendInvoiceEmailDialog.tsx` | Render the cancellation refusal; show the paid-receipt line. |
| `packages/billing/src/components/billing-dashboard/.../DesignerVisualWorkspace.tsx` | Correct the stale comment. |
| locale files (all 11) | Four new strings: copy action, copied toast, cancelled refusal, paid-receipt notice. |

No migration. No schema change.

## Order

1. **D1 + D2 — logo.** Both screen builders on the adapter, duplicate lookup deleted, unit test that a
   branding-only tenant's screen view model carries the branding logo, and that a tenant with a non-default
   billing address renders the billing address.
2. **D3 + D4 — status gate.** Guard in action and handler, paid-receipt wording, tests: a cancelled invoice
   produces no email and no `email_sending_logs` row; a paid invoice sends a receipt-labelled message.
3. **D5 + D6 — copy link.** Action + panel control, eligibility tests (voided, paid, unfinalized, online
   payment off, no public origin ⇒ reason, never a link), then a manual walkthrough on the card app
   (`http://feature-invoices-branding-logo-on-screen-views-block-ema.localhost:3514`, login
   `qa@emeraldcity.oz`) captured for the review packet.

## Not doing

- Not touching the PDF path — PR #3884 already fixed it and this card must not disturb it.
- No "send anyway" override for voided invoices (see D3).
- No changes to token lifetime, eligibility semantics, or the portal's own Pay Now.
- No regeneration of branding previews / `tenantBrandingPreview` behavior.
- No refactor of `getClientDocumentLogoUrl` callers outside the tenant-party role.

## Risks

- `getFullInvoiceById` is on the hottest invoice path. `fetchTenantParty` costs two queries where one exists
  today, but it joins the existing `Promise.all` (parallel, not serial) and is already on the PDF path for
  the same invoices. Measure preview open time during review rather than assume.
- D2 changes a user-visible address in the pre-generation preview. Assert it with a test before the PR.
- The handler guard touches a path shared with autopay and receipt flows: grep every caller before landing,
  and gate on `cancelled` only so paid/autopay behavior is untouched.
- The preview panel is also the designer's existing-invoice preview; the logo fix must not leak into the
  template editor's sample-data rendering.

## Acceptance

- Managed Nerds (branding-only logo) shows their logo on the MSP preview, the client-portal invoice view, and
  the designer preview of an existing invoice — screenshots in the review packet.
- Emailing a voided invoice is refused with a sentence saying why; no email is sent and no log row appears.
- Emailing a paid invoice sends a receipt-style message that names the invoice as paid.
- "Copy payment link" yields the same `/pay/<token>` URL the email would have carried, and shows a reason
  instead of a link for every ineligible case.
- Tests green: unit for all four behaviors, plus the walkthrough above.
