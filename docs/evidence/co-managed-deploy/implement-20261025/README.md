# Bulk handback recovery and current acceptance

Resuming an interrupted bulk handback replaced the resume prompt with a closed
results panel. The server returned mixed per-ticket outcomes, but the operator
could not see them. The composer now opens that panel before moving focus to
the result list. Frozen request identity, authorization and server receipts are
unchanged.

The new regression reproduces reload recovery with no fresh selection and a
mixed conflict/success response. It fails against the old component, then passes
with the repair. The existing handback and qualified-list suites pass all 42
cases. See [failure](handback-before.txt) and [passing checks](handback-after.txt).

The defect was observed on canonical production source `c04a67fff5`, build
`build-1792926045353`. The existing app remains running while an isolated repair
build is prepared. No repaired-production acceptance is claimed by this initial
packet. Subsequent receipts must retain the actual source and build they test.

New browser attempts and their original failures remain under
`/tmp/alga-smoke-evidence/co-managed-it-implement-20261025/`. Onboarding exercised
lost-response retry, one retained operation, cancellation and seat release,
original delivered invitation claim, customer acceptance and native reload.
The simulator purchase/allocation run reconciled purchased capacity 14→15,
proved allocation persistence and its active-seat floor, then restored both
capacity and allocation. Delegation exercised a new exact-board approval and
stale-editor denial after revocation. Task assignment and stale-edit checks
retain their separate failed final instrumentation assertions. These bounded
checks do not accept every requirement in their larger matrices.

The source census now spells out both external portions and their owner without
waiving the associated in-card work:

- `clientIntegration:T018`: real Stripe test-mode shortfall checkout and
  reconciliation, including the licensed recurring price. The release operator
  supplies the approved Stripe account, test credentials, price and provider
  receipts. Configured simulator results remain simulator evidence.
- `clientIntegration:T019`: real issuer availability for a tenant-bound signed
  Pro license and refresh on an isolated self-host installation. The release
  operator supplies the installation and coordinates the license issuer.
  Locally signed fixtures do not prove real issuer availability.

Production promotion, fresh Alice login, QA navigation and supported Open
Review were already confirmed. The OOM report labels its deployment-pending
observations as historical. Its bounded same-process dev proof is preserved;
long-term memory stability remains unproved. Full guide and release readiness
remain incomplete.


## Qualified queue return defect

The next live queue check found that the detail screen's Back button targeted
retired `/msp/co-management/tickets` and discarded the applied scope. Shared
row links now carry the originating qualified list URL, and the detail route
normalizes that context to the customer-list route before composing native
back navigation. External destinations and unrelated application routes fall
back to Customer Tickets. Customer, state, search, sort and pagination remain
presentation state; authorization still runs on every queue read.

The component regression fails on the served implementation (one failure,
23 passes). The repaired component, qualified list, return-context validation
and retired-panel contract pass 64 checks. The retired-panel contract is held
for the final tooling/evidence update. Repaired production return-navigation
acceptance remains pending the next prepared build and browser rerun.
