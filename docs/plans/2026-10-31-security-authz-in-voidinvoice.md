# Design — require the dedicated `invoice:void` permission in `voidInvoice`

Card: `98236eaf` · Security finding (authz, high) from PR #3986 review, merge `f08108639c3b`
Fingerprint: `packages/billing/src/actions/voidInvoiceActions.ts#voidInvoice` (lines 33–40)
Base: main @ `2754f79c81`

## Finding (confirmed)

`voidInvoice` gates on `hasPermission(user, 'invoice', 'update')`
(`packages/billing/src/actions/voidInvoiceActions.ts:38`). The permission catalog
already defines a separate capability:

```
{ resource: 'invoice', action: 'void', description: 'Void invoices', ... }   catalog.cjs:197
```

A repo-wide search shows **no code checks `invoice:void` anywhere** — the permission
is catalogued (and granted to `msp:Admin`/`msp:Finance` by default) but never enforced.
A custom role granted `invoice:update` and explicitly denied `invoice:void` can therefore
void a finalized invoice: `voidInvoiceLocally` (`invoiceVoidCore`) cancels the invoice,
reverses applied credits and hour blocks, and writes cancellation ledger entries
(`voidInvoiceActions.ts:176–185` and below).

## Decision

Replace the `invoice:update` gate with `invoice:void`. Do **not** accept either
permission: update is a broader editing capability, and accepting it leaves the
reported hole open for every role that has update. Voiding is destructive and
irreversible in the ledger, so the dedicated capability is the correct floor.

Order of checks in `voidInvoice` stays:

1. client-user exclusion (`user.user_type === 'client'`) — unchanged, first;
2. `invoice:void` (replaces `invoice:update`);
3. input validation, load, guarded transitions — unchanged;
4. existing `accounting_integrations:remote_mutate` check for mapped/connected
   invoices — unchanged (it guards a *different*, outward mutation and must not
   be folded into the permission gate).

## Changes

| File | Change |
|---|---|
| `packages/billing/src/actions/voidInvoiceActions.ts` | `hasPermission(user, 'invoice', 'update')` → `hasPermission(user, 'invoice', 'void')`; update the comment and denial string to name void. |
| `packages/billing/tests/actions/voidInvoice.authorization.test.ts` (new) | Behavioural regression: a user whose role allows `invoice:update` but denies `invoice:void` is refused before any write; a user with `invoice:void` passes the gate and reaches the local void path. Fails on the current code, passes after. |

No catalog change is needed — the permission exists. No migration.

## Test plan

- Unit/action test (mocked `hasPermission`, `createTenantKnex`, `tenantDb`):
  - deny case: update=true, void=false → `{ success: false, error: /void/ }`, and
    `voidInvoiceLocally` / transaction never invoked;
  - allow case: void=true → proceeds (existing happy-path assertions reused);
  - client portal case still refused first regardless of grants.
- Grep guard: no remaining `invoice:update` reference in the void path.

## Deliberately not doing

- No change to `delete`/`credit`/`finalize` permission semantics — separate capabilities,
  separate findings if any.
- No UI change: `InvoicePreviewPanel.tsx:459` already surfaces the action result; the
  button is rendered for users who can see the invoice, and a denied call returns a
  clear permission error. Hiding the control on `invoice:void` is a UI-polish
  follow-up, not a security requirement (the server gate is authoritative). *If the
  reviewer prefers, gate the button with the same capability in the same change.*
- No bulk-void entry point exists (`grep voidInvoice` → only `InvoicePreviewPanel`),
  so there is no sibling call site to fix. If `FinancialService.bulkInvoiceOperation`
  later gains a void branch (separate card `51a25fe9`), it must use the same gate.

## Risks

- Custom roles that currently void through `invoice:update` will start being denied.
  That is the intended correction; default `msp:Admin`/`msp:Finance` roles already hold
  `invoice:void`, so no default workflow changes.
- Any integration/e2e fixture that authorizes with only `invoice:update` and then voids
  will need the grant added — check the smoke fixture before Smoke Test.

## Acceptance

`security-finding-resolved` passes when the action checks `invoice:void`, the regression
test denies an update-only role and admits a void-capable one, and the focused billing
action suite is green.
