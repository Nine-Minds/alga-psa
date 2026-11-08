# Design — authorize membership writes where the row is written, not where the request is declared

Card `f2aac11d` — Security: authz in `saveContractLineEdit` (finding from PR #3974, merge `450e05f46b19`).

## The finding, confirmed

`saveContractLineEdit` (`packages/billing/src/actions/contractLineSaveAction.ts:140`) gates `billing:create`
on the **caller-declared** `draft.added_service_ids` (line 157) — a request field. It then processes
`draft.bucket_overlays` (line 353) with only `billing:update`, calling
`upsertBucketOverlayInTransaction` (line 358). That helper creates `contract_line_buckets`,
`contract_line_bucket_services` and **upserts the service into `contract_line_services`**
(`packages/billing/src/actions/bucketOverlayActions.ts:269-308`).

So an update-only user submits `added_service_ids: []` plus an overlay for an unattached tenant service,
and obtains a new **service membership** — the resource that `addServiceToContractLine` guards with
`billing:create`. The declared delta is authorization input, and the effective delta is computed
somewhere else. That is the defect in one sentence.

## The rule

> **Authorization is decided from the effective write, inside the transaction, at the moment the row
> is written — never from a caller-declared list.**

Two permissions, one classifier:

- the write will **create** the membership or its configuration → `billing:create`
- both already exist → the write only **modifies** them → `billing:update`

(Stated as "either row absent" rather than "membership absent" because the add-service path can create a
configuration for a membership that already exists — see the twin card `f1526cf7`. One rule, both cards.)

This single rule also closes the twin finding on `addServiceToContractLine` (card `f1526cf7`), where an
"add" of an already-attached service silently updates its configuration under `billing:create`.

## Mechanism — one helper, in the membership module

`packages/billing/src/lib/billing/contractLineMembership.ts` already owns membership rows; the rule
belongs there:

```ts
export async function authorizeMembershipWrite(
  trx: Knex.Transaction,
  tenant: string,
  user: IUser,
  contractLineId: string,
  serviceId: string,
): Promise<{ membershipExists: boolean; configurationExists: boolean }>
```

1. `SELECT ... FROM contract_lines WHERE contract_line_id = ? AND tenant = ? FOR UPDATE` — lock the line,
   so two concurrent saves cannot both observe "absent" and race into a create.
2. `SELECT ... FROM contract_line_services WHERE contract_line_id = ? AND service_id = ?` (tenant-scoped
   via `tenantScopedTable`) — **this** is the effective state.
3. `hasPermission(user, 'billing', existing ? 'update' : 'create', trx)`; on failure throw the module's
   typed permission error naming the service and which permission was required.
4. Return `{ membershipExists }` so callers can branch without re-reading.

`upsertBucketOverlayInTransaction` calls it **first**, before any bucket row is written, and therefore
takes `user` as a parameter. That is the point of putting it in the shared helper rather than in
`saveContractLineEdit`: a future caller of the overlay helper cannot forget the rule.

`addServiceToContractLineInTransaction` calls the same helper on entry; when `membershipExists` is true
the write is an update and requires `billing:update`, when false it requires `billing:create`. No second
authorization code path is introduced.

## What changes in `saveContractLineEdit`

- The declared-delta check at line 157 **goes away**. It is a second, weaker source of truth for the
  same question; keeping it invites the next reader to believe the list is what matters. Every membership
  write it was approximating now carries its own authoritative check, inside the transaction.
- The overlay loop keeps `billing:update` for the *bucket totals* mutation (that is genuinely an update of
  the line's bucket configuration) and gains the helper's membership classification for the attach it
  performs underneath. A user with update-but-not-create who sends an overlay for an unattached service
  is refused inside the transaction, whatever the request said.
- Authorization failures keep their current shape (`Error: Permission denied: ...` → the action's existing
  error surface); no new UI, no new toast path.

## Locking / concurrency

The line row lock is what makes "does it exist?" a fact rather than an observation: without it the
classifier is check-then-act. `FOR UPDATE` on `contract_lines` serializes membership writes per line,
which is already the granularity of `getContractLineEditVersion`'s optimistic token — the two are
complementary (token catches stale drafts, the row lock catches concurrent writes).

## Tests (regression first)

`packages/billing/src/actions/__tests__/contractLineSaveAction.authz.test.ts` (new):

1. update-only user + overlay for an **unattached** service → rejected, and **no** `contract_line_services`
   row exists afterwards. *Fails before the fix — this is the regression.*
2. update-only user + overlay for an **attached** service → succeeds (totals only, membership untouched).
3. create-only user + overlay for an unattached service → succeeds, membership + bucket rows written.
4. no-create user + `added_service_ids` non-empty → still rejected (existing behaviour preserved).
5. Two sequential transactions on the same line: the second sees the first's membership and requires
   update (no double-create).
6. Bucket overlay for a service the user may not attach leaves `contract_line_buckets` **and**
   `contract_line_bucket_services` empty as well — the refusal must not leave a half-written pool.

## Not doing

- No change to `getContractLineEditVersion` or the token semantics.
- No new permission names, no role changes.
- No UI change: the wizard never offered an overlay for an unattached service; the API did.
- Not touching the legacy direct overlay endpoint's public shape beyond the helper it now runs through.

## Order of work

1. `authorizeMembershipWrite` + unit test for the classifier (create vs update, tenant scoping, refusal text).
2. Wire `addServiceToContractLineInTransaction` (also satisfies the twin card's fix).
3. Wire `upsertBucketOverlayInTransaction`; delete `saveContractLineEdit`'s declared-delta check.
4. Regression tests 1-6 above; run the billing suite and `tsc`.
5. `security-finding-resolved` evidence: finding → test 1 (fails without the helper), plus test 2 for the
   non-regression direction.

## Risks

- **Removing the early create check** could surface a path that previously relied on it and does not go
  through either helper. The billing suite plus `tsc` is the check; if a path appears, it gets the helper,
  not a re-added flag.
- **`FOR UPDATE` cost**: one extra row lock per save transaction, on a row the transaction already
  updates. Absorbed by the existing transaction; not a new contention source.
- **Typed refusal text** is asserted by UI tests elsewhere; keep the existing `Permission denied:` prefix
  and only change the tail.
