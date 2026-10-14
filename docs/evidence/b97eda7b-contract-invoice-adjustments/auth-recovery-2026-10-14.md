# Invoice editor authentication recovery

Application revision: `8e3ef4fd9ab1aace63a5d523f2286edf47473848`, PR #3499.

The invoice editor handles an expired session without discarding pending rows.
`updateInvoiceManualItems` returns a serializable `UNAUTHENTICATED` result when
the authentication wrapper rejects the request or the subsequent session lookup
has no user. Both paths exit before invoice mutation. An authenticated caller
without invoice-update permission still receives `PERMISSION_DENIED`.

The editor offers sign-in in a separate tab and an explicit retry using the
existing operation ID and expected revision. It does not automatically replay
the save. Client refresh and callback failures after confirmed persistence are
reported as saved changes requiring a page refresh.

## Independently verified

From `packages/billing`:

```sh
npx vitest run src/components/billing-dashboard/ManualInvoices.expandedSave.test.tsx tests/invoiceModification.manualRecurringGuard.test.ts
npm run build
NODE_OPTIONS=--max-old-space-size=8192 npm run typecheck
```

All three commands exited 0: 22 behavioral tests passed, the billing tsup package
build passed, and billing typecheck passed with no diagnostics. The package
build is not a full Next production build.
The tests cover serialized authentication failures, no database mutation on
rejection, preserved permission denial, retained expanded edits, explicit retry
with the same operation identity, and post-save refresh/callback failures.

Current-source translation CI run `38509817847` completed successfully.

## Remaining acceptance

The cause of repeated same-port session loss on 3185 remains unproven. This
change is an editor recovery mitigation, not evidence that session continuity
has been repaired. No cookie, secret, revocation or authorization policy changed.

No application server was started or restarted, no shared credentials were
reset, and no invoice or delivered accounting history was changed. Full server
build validation remains pending: local swap was almost exhausted, and
current-source production regression CI run `38509817942` was pending at audit.

On an authorized smoke run, sign in separately on canonical ports 3185 and
23185. Inspect the actual session before and after draft selection, save,
reload and navigation. On an owned draft, expire the session, verify that edits
remain visible, sign in again, and explicitly retry. Verify one persisted save
and stable ledger postings on repeat. Also complete discount removal,
permission/lifecycle/export protection, portal and signed true-up output checks.
Inspect the actual session in the exact Open Review pane; its reported account
alone does not establish a valid browser session. Preserve delivered fixtures.
