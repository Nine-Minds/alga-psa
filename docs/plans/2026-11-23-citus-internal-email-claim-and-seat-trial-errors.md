# Co-managed seat invites on Citus: platform-wide email claim, named trial refusals, one eligibility rule

Status: design for review · card `24e96db5-4af1-47c2-abc4-8b67e7526da2` · PSA alga-2026-0003412

## 1. Problem (verified at `fe1d1de9f3`, prod report image `23f02341`)

1. **Seat invite fails on Citus.** `User.findInternalEmailClaim` (`packages/db/src/models/user.ts:169-196`)
   runs a platform-wide scan of `co_managed_provisioning_operations` (`o`, distributed on its own
   `tenant` — the sponsor) and **left-joins `user_invitations`** on `i.tenant = o.customer_tenant`.
   Citus refuses: *complex joins are only supported when all distributed tables are co-located and
   joined on their distribution columns* (0A000). It is reached only when no internal user already holds
   the address — the normal case for a new technician — so **every** co-managed Seat invite to a fresh
   email fails, trial or paid.
   Call sites: `packages/co-managed/src/seatInvitation.ts:233` (invite) and `:393` (accept);
   `packages/co-managed/src/provisioning.ts:103` (workspace administrator).
   Tests passed on plain Postgres; only Citus rejects the join.
2. **The trial panel hides the reason.** `ee/server/src/components/co-managed/CoManagedSeatTrial.tsx:66`
   — `run()` catches every failure and sets the single `actionFailed` message. Nothing is logged, so a
   production 0A000 looks like a generic UI failure.
3. **Two eligibility rules.** `getSeatTrialOfferAction`
   (`ee/server/src/lib/actions/coManagedSeatTrialActions.ts:111-131`) decides `canStart` from
   capability admission + purchase surface + trial-sponsor base row. `prepareCoManagedSeatTrial`
   (`ee/server/src/lib/co-managed/seatTrial.ts:22-29`) additionally requires `product_code = psa`,
   `plan = pro`, non-manual billing, not suspended, and (when an entitlement row exists)
   `source = hosted`. So the invite button can render for a tenant whose prepare is guaranteed to fail.

## 2. The claim rewrite — no cross-tenant join

A single-table query may scan every shard on Citus; only the join is illegal. So the claim becomes two
tenants-scoped reads evaluated in TypeScript, with the *same* meaning kept:

```
// (1) candidate setups: one single-table scan (no join), same discovery tenant + unscoped posture
//     as the users query directly above it.
const setups = discovery.unscoped('co_managed_provisioning_operations as o', INTERNAL_EMAIL_CLAIM_REASON)
  .whereRaw("lower(trim(o.request->'administrator'->>'email')) = ?", [normalized])
  .select('o.operation_id', 'o.customer_tenant', 'o.administrator_invitation_id', 'o.state', 'o.created_at');
// excludeTenant / excludeOperationId applied exactly as today

// (2) per distinct customer_tenant: one co-located lookup — the predicate Citus needs
const used = await tenantDb(db, customerTenant)
  .unscoped('user_invitations', INTERNAL_EMAIL_CLAIM_REASON)
  .whereIn('invitation_id', idsForThatTenant)
  .select('invitation_id', 'used_at');
```

Predicate preserved verbatim from the current `where` clause, per setup:

| setup | invitation row | claims? |
|---|---|---|
| state ∈ {queued, provisioning, failed} | none | **yes** |
| any state | exists, `used_at` null | **yes** |
| any state | exists, `used_at` set | no |
| other state | none | no |

`excludeUserId` keeps applying to the users query only; `excludeTenant` / `excludeOperationId` to the
setups query as today. Return the first match in a deterministic order (`created_at`, `operation_id`) —
the old `.first()` was arbitrary. Bound: the setup scan selects one email, so the tenant loop is over at
most a couple of ids; dedupe `customer_tenant` and skip rows with no `administrator_invitation_id`.

## 3. Named trial refusals (item 3)

The seat panel already has the contract this needs, so reuse it rather than invent a second one:

- `server/src/lib/actions/coManagedSeatActions.ts:40-47` documents and implements it: *"A refusal the
  screen can name is returned as `{ rejected: true, errorCode }`, because a thrown error reaches the
  browser as a redacted failure."* Its `refused()` maps `CoManagedSeatArrangementError`,
  `CoManagedSeatInvitationError` and `CoManagedAdmissionError` to their `.code`.
- `server/src/components/co-managed/coManagedSeatMessage.ts` maps those codes to copy;
  `CoManagedSeatPanel.run()` renders it.

Changes:

1. **Typed domain error.** Add `CoManagedSeatTrialError` to `ee/server/src/lib/co-managed/seatTrial.ts`
   with `SPONSOR_NOT_ELIGIBLE | TRIAL_CLAIM_UNAVAILABLE | OPERATION_CONFLICT`, replacing the bare
   `new Error('SPONSOR_NOT_ELIGIBLE' | 'TRIAL_CLAIM_UNAVAILABLE' | 'OPERATION_CONFLICT')` throws.
   (Seat-invitation refusals already arrive typed through `inviteCoManagedSeatTechnician`.)
2. **One rejection helper.** Extract `refused()` and `CoManagedRejection` from
   `coManagedSeatActions.ts` into `server/src/lib/actions/coManagedRejection.ts`, add
   `CoManagedSeatTrialError` to its recognised set, and import it in both the seat actions and the ee
   trial actions. One mapping table, not two.
3. **Actions.** Wrap the four mutations the trial panel runs (`prepare`, `resume`, `replace`, `cancel`)
   so a known refusal returns `{ rejected: true, errorCode }`, and `logger.error('co-managed seat trial:
   <action> failed', error)` logs the underlying cause server-side (the invitation delivery failure
   included). Unknown errors still throw, as in the seat actions.
4. **Panel.** `CoManagedSeatTrial.run()` takes the same shape as `CoManagedSeatPanel.run()`:
   `work: () => Promise<{ rejected: true; errorCode: string } | { ok: string }>`; on `rejected` it sets
   `coManagedSeatMessage(result.errorCode, t)`, on success the existing notice. `boardChoicesFailed`
   stays as-is. Import `coManagedSeatMessage` from `@/components/co-managed/coManagedSeatMessage` —
   the same `@/components/co-managed/*` alias this file already uses for `CoManagedSeatContactField`.
5. **Copy.** Add `coManaged.seat.error.trialClaimUnavailable` ("This trial is already in use or was
   started for another client. Refresh and try again.") and
   `coManaged.seat.error.trialSponsorNotEligible` for the trial surface; `SPONSOR_NOT_ELIGIBLE` keeps its
   existing blocker copy. Every language file under `server/public/locales/*/msp/licensing.json`.

## 4. One eligibility rule (item 4)

New `ee/server/src/lib/co-managed/seatTrialEligibility.ts`:

```
readSeatTrialSponsorEligibility(db, tenant): Promise<{ eligible: boolean; baseUntil: Date | null; reason: 'SPONSOR_NOT_ELIGIBLE' | null }>
```

reads `tenants(product_code, plan, billing_source, suspended_at)`, `co_managed_entitlements(source)` and
`co_managed_trial_sponsors(base_until)` in one tenant-scoped call and applies exactly prepare's current
predicate. Both sides call it:

- `getSeatTrialOfferAction`: `intake` becomes capability admission ∧ purchase surface open ∧
  `eligible` (replacing the inline sponsor-row check); `canStart` therefore cannot be true for a tenant
  prepare would refuse.
- `prepareCoManagedSeatTrial`: after the advisory lock, call the same function and throw
  `CoManagedSeatTrialError('SPONSOR_NOT_ELIGIBLE')` when false — replacing the inline checks. The check
  stays inside the transaction (it must), but the rule has one definition.

`admits()` and `isCoManagedPurchaseSurfaceOpen()` stay at the action layer (async capability services);
prepare's wrapper already carries both gates.

## 5. The other joins (item 2) and the guard

Audit: `leftJoin|innerJoin|joinRaw` over `packages/co-managed/src`, `ee/server/src/lib/co-managed`,
`server/src/lib/co-managed` finds **no other cross-table join** — every other query is single-table and
tenant-scoped, and `provisioning.ts`'s pending-invitation read is single-table on the sponsor tenant. The
only offender is this model, shared by all three call sites. No code change beyond §2 is expected; the
design records the audit so the implementer confirms it with the same grep.

Guard: a **Citus runtime integration test**, not just a Postgres one, because this defect is invisible on
Postgres. Add `server/src/test/integration/coManagedInternalEmailClaim.integration.test.ts` using
`createTestDbConnection({ databaseName, runSeeds: false })` (the Citus runner supplies
`TEST_DB_BACKEND` / `TEST_MIGRATIONS_DIR`; see `remainingBucketUnits.integration.test.ts` for the
shape), and register it in `scripts/lib/citus-runtime-inventory.mjs` so CI runs it against a distributed
schema. Cases, seeding two tenants plus an operation and its invitation:

1. queued setup, no invitation → `pending_administrator` (no 0A000);
2. unused invitation on a completed setup → claimed;
3. used invitation → not claimed;
4. internal user in another tenant → `{kind:'user'}`;
5. `excludeTenant` / `excludeOperationId` / `excludeUserId` honoured;
6. an email with no claim → null.

A regression to a cross-tenant join fails case 1 on Citus with the production error.

## 6. Explicitly not doing

- No change to the paid seat purchase/conversion flow or to provisioning state machine semantics.
- No new cross-tenant join anywhere; no rewrite of the users query (already legal).
- No client-side retry logic or hidden-error fallbacks: unknown errors still throw and still show the
  generic message.

## 7. Tests

- The Citus integration test above (+ its Postgres sibling runs in the normal suite).
- `server/src/test/integration/coManagedSeatTrial.db.test.ts` and
  `coManagedSeatTrialOfferAtGate.db.test.ts`: offer `canStart` false for a tenant prepare refuses.
- `ee/server/src/__tests__/unit/coManagedSeatTrialActions.tenantIsolation.test.ts`: rejection shape for
  `SPONSOR_NOT_ELIGIBLE`, `TRIAL_CLAIM_UNAVAILABLE`, and a mapped invitation refusal.
- `server/src/test/unit/co-managed/coManagedSeatMessage.test.ts`: new keys resolve.
- Panel test: a rejected code renders its specific copy, not the generic one.

## 8. Acceptance criteria

1. On Citus, `findInternalEmailClaim` returns a claim with no 0A000 (integration test green on the
   Citus runtime runner).
2. Inviting a seat technician (trial and paid) to an email with no internal user sends the invitation —
   the card's production repro.
3. The trial panel shows a named reason for each known refusal and the server log carries the cause.
4. The invite button is not rendered when `prepareCoManagedSeatTrial` would refuse for sponsor
   eligibility.
5. No cross-tenant join in the co-managed path (re-audited by the same grep).

## 9. Risks

| Risk | Mitigation |
|---|---|
| Claim semantics drift while dropping the join | §2's predicate table is the spec; cases 1-6 pin each row |
| Extra round trips per claim | one setup scan + one lookup per distinct customer tenant; candidates are one email's setups (normally ≤2) |
| `unscoped` discovery reads hide a tenant mistake | the same posture as the working users query; the invitation read is passed the row's own `customer_tenant` |
| Typed error class changes tests that assert message text | update those assertions to codes; the seat panel already treats codes as the contract |
| Unified rule refuses a tenant that used to work | the rule is exactly prepare's current predicate, so only the offer's *visibility* changes, never prepare's acceptance |

## Citus audit (repair round)

The first audit grepped `leftJoin|innerJoin|joinRaw` and missed a join written as `tenantJoin(..., { tenantPredicate: 'literal' })`. Repair round 1 redid it over `packages/co-managed/src`, `ee/server/src/lib/co-managed`, `ee/server/src/lib/actions/coManaged*`, `server/src/lib/co-managed` and `server/src/lib/actions/coManaged*`.

- `grep -rn tenantPredicate <paths>`: one hit before this round, `ticketQueue.ts` (home `co_managed_ticket_references` left-joined onto owner `tickets`). A real cross-tenant join (0A000 on Citus). Fixed: the home references are read in their own home-scoped query and enter the owner query as an inline `jsonb_to_recordset` relation. No other `tenantPredicate` in the path (the remaining literal joins are in billing and notifications, outside this path; not inspected).
- `grep -rn tenantJoin <paths>`, receivers compared per file against the base query's scope: every file that uses two scopes (`effortTotals` `owner`/`mspOwner`, `projectTaskConversation` and `ticketConversation` `owner`/`customer`/`home`, `managementPolicy` `context.home`) joins each query only to tables of its own scope's receiver. Each cross-tenant read is a separate query combined with `UNION ALL` or in memory. No hit.
- `grep -rnE "joinRaw|leftJoin|innerJoin|\.join\(|JOIN "`: raw SQL joins are `timeWorkContext.ts` (`tr.tenant = w.tenant`, same tenant), catalog queries over `pg_*`, and the new `ticketQueue` recordset join. No join on `customer_tenant`/`sponsor_tenant`.
- `grep` for `customer_tenant|sponsor_tenant|owner_tenant` equated to a tenant column next to `join|on(|andOn`: no hit.

Seat marker (`users.seat_reader`): the only path that binds a user to an assignment is `acceptCoManagedSeatInvitation`; it now inserts the user with `seat_reader: true`. Invite, refresh, revoke-invitation, trial replace/resume/conversion and arrangement end do not write a binding state or `user_id`; revocation clears the marker (unchanged).
