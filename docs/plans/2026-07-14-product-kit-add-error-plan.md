# Fix: adding products to a kit fails in production (Citus ON CONFLICT restriction)

## Problem

Adding a component to a kit on `/msp/inventory/kits` fails in production with an
HTTP 500. Observed on sebastian-blue on 2026-07-13, 13:53–13:54 UTC: five POSTs
to `/msp/inventory/kits` returned 500, each matching this error in the app log:

```
error: insert into "kit_components" (...) on conflict ("tenant", "kit_service_id", "component_service_id")
do update set "quantity" = $5, "updated_at" = CURRENT_TIMESTAMP returning *
- functions used in the DO UPDATE SET clause of INSERTs on distributed tables must be marked IMMUTABLE
```

Production runs Citus, and `kit_components` is a distributed table. Citus
rejects non-immutable functions (`CURRENT_TIMESTAMP` is stable, not immutable)
in the `DO UPDATE SET` clause of `INSERT ... ON CONFLICT` — at plan time, so
every add fails, not just quantity-update conflicts. Local dev runs plain
Postgres, which accepts the statement; that is why tests and local smoke passed.

The offending code is `addKitComponent`, which upserts via Knex
`.onConflict(...).merge({ quantity: qty, updated_at: trx.fn.now() })` —
`trx.fn.now()` compiles to `CURRENT_TIMESTAMP` inside the DO UPDATE SET clause.

## Scope

Fix the three `.merge()` sites in `packages/inventory/src/actions/kitActions.ts`
that pass `trx.fn.now()` — the confirmed failure plus two latent sites with the
identical pattern:

| Site | Function | Table |
|---|---|---|
| `kitActions.ts:816` | `addKitComponent` | `kit_components` (confirmed failing) |
| `kitActions.ts:614` | `createKitProduct` | `service_prices` (latent) |
| `kitActions.ts:707` | `updateKitProduct` | `service_prices` (latent) |

Explicitly out of scope (decided in design review): no lint/test guard against
reintroducing the pattern, and no broader Citus-compatibility audit of the
inventory module.

Plain `.update({ ..., updated_at: trx.fn.now() })` calls elsewhere in the file
are fine — the Citus immutability restriction applies only to the
`ON CONFLICT DO UPDATE SET` clause — and are not touched.

## Change

In each of the three `.merge()` calls, replace `trx.fn.now()` with a
JS-computed timestamp passed as a bind parameter, matching the idiom used by
every other `.onConflict().merge()` in the codebase (e.g.
`packages/billing/src/lib/quoteApprovalSettings.ts`,
`packages/integrations/src/actions/integrations/tacticalRmmActions.ts`):

```ts
.onConflict(['tenant', 'kit_service_id', 'component_service_id'])
.merge({ quantity: qty, updated_at: new Date().toISOString() })
```

A bind parameter is a constant to the planner, so Citus accepts it on
distributed tables, and behavior on plain Postgres is unchanged.

## Verification

1. `npx vitest run packages/inventory/src/actions/kitActions.integration.test.ts`
   — covers add, duplicate-add (upsert/quantity-merge), and validation paths on
   the local Postgres stack.
2. Type check the package (`tsc --noEmit` scoped to `packages/inventory`, or the
   package build).
3. Manual smoke on the running dev stack (port 3209): open
   `/msp/inventory/kits`, create a kit, add a component, re-add the same
   component with a different quantity (exercises the merge path), confirm the
   component list updates and `kit_components.updated_at` changes.
4. Grep the compiled statement expectation: no `CURRENT_TIMESTAMP` remains in
   any `merge(` call in `kitActions.ts`.

Note: local Postgres cannot reproduce the Citus failure, so verification proves
non-regression of behavior; the Citus fix is proven by construction (no
function call remains in the DO UPDATE SET clause) and confirmed after deploy
by retrying the add-component flow in production.
