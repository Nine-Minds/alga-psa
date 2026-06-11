# SCRATCHPAD — QBO Slice 4: Payments Out, Class Tracking, Multi-Realm

## Decisions

- **2026-06-11 — Intuit webhooks excluded** (user-confirmed). 15-minute CDC
  polling is competitive; webhooks get their own plan only if hosted latency
  becomes a real complaint. Keeps hosted/appliance behavior identical.
- Deposit account defaults to Undeposited Funds, resolved at delivery time
  (not stored) so renamed/recreated accounts don't strand a stale ref.
- Class granularity v1 = per item mapping metadata + tenant default; no
  per-client/per-invoice overrides.
- `default_realm` becomes an explicit tenant setting; phase-1's
  first-stored-key ordering remains the fallback when unset.

## Key file paths

- Payment producer site: `recordExternalPayment` (slice-1 extraction from
  `ee/server/src/lib/payments/PaymentService.ts`)
- Echo-suppression mechanism: payment mapping rows in
  `tenant_external_entity_mappings` (slice-1 design)
- Catalog action pattern: `packages/integrations/src/actions/qboActions.ts`
- Realm defaulting to swap to setting-backed:
  `getDefaultQboRealmId` in `packages/integrations/src/lib/qbo/qboClientService.ts`
- Settings connection card to become a list:
  `packages/integrations/src/components/settings/integrations/QboIntegrationSettings.tsx`
- Batch dialog for the realm picker:
  `packages/billing/src/components/billing-dashboard/accounting/AccountingExportsTab.tsx`

## Gotchas

- QBO Payment currency must match the customer's currency; mismatches ride
  the slice-1 currency exception path — multi-currency tenants will hit it.
- DepositToAccountRef must reference an account of an allowed type
  (Other Current Asset/Bank); filter in getQboAccounts, not just in the UI.
- The double-entry scenario (bookkeeper manually re-keys a pushed Stripe
  payment) is detected at application time as an over-allocation on a
  settled invoice — exception, never auto-reversal.
- Disconnecting one realm of several must not deregister the other realm's
  cycle (singleton keys are per tenant×realm).

## Implementation notes (built 2026-06-11)

- Payment push producer lives INSIDE recordExternalPayment's success path
  with a provider !== 'quickbooks' echo guard, so any future provider pushes
  automatically; reverseExternalPayment pushes nothing (refunds out of scope).
- DepositToAccountRef omitted when unconfigured — QBO defaults to Undeposited
  Funds natively (no account lookup needed). PaymentRefNum truncated to QBO's
  21-char limit.
- Echo suppression verified end-to-end: push stores String(response.SyncToken)
  in the payment mapping; the CDC change for the same payment carries the same
  token → inbound applier no-ops.
- Double-entry guard: NEW external payments against fully-settled invoices
  file an accounting_sync_unmapped_payment exception with reason
  'over_application' and apply nothing; partial invoices accept normally.
- Realm UX landed in QboSyncHealthPanel (realm list + make-default via
  AccountingSyncHealth.realms + setDefaultQboRealm) instead of the
  integrations connection card — package-direction constraint. Batch dialog
  realm picker appears only with >1 realm. Wizard intentionally runs against
  the default realm (resolveDefaultRealm inside the onboarding actions).
- resolveDefaultRealm (settings.defaultRealm validated against the credential
  map, else first-stored-key) adopted by billing call sites; syncProducers'
  three getDefaultQboRealmId calls left as a follow-up TODO (file ownership
  collision during parallel build) — behavior identical until a tenant sets a
  non-first default realm AND relies on producer enqueue realm stamping.
- Settings-dir contract suites (Microsoft/Xero/MspSso) have 13 pre-existing,
  shuffle-sensitive failures — identical on a clean tree (stash-verified).
