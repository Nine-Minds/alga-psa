# Internal-user seat lock

Card 17ff09ce (PSA alga-2026-0002928). Branch `feature/security-authz-in-createusingtransaction`.

## Finding

The seat check (`checkInternalUserLicenseLimit`) read the active-user count and the
write that consumed the seat ran later, with no lock between them. Two concurrent
requests could both read "one seat left" and both succeed, taking a tenant past
`licensed_user_count`, the solo-plan limit, or the signed EE appliance seat claim.
The same check-then-write gap existed in `UserService.createUsingTransaction`,
`addUser`, reactivation through `updateUser`, and invitation send/accept.

Measured on real Postgres with the lock disabled: 8 concurrent
`UserService.create` calls at limit 2 / used 1 produced **8 winners** (expected 1);
4 concurrent reactivations produced **4 winners**.

## Mechanism

`checkInternalUserLicenseLimit(trx, tenant, opts)` requires a real `Knex.Transaction`
(it throws for anything else). Its first statement is

```sql
SELECT pg_advisory_xact_lock(hashtext('internal_user_seats'), hashtext(<tenant>))
```

- `internal_user_seats` is the lock **namespace**, not a table.
- The lock is transaction-scoped, so it lasts until commit or rollback and covers the
  check plus the insert, reactivation or invitation write that follows.
- The key is per tenant: tenants never block each other.
- Taking it again in the same transaction is a no-op, so callers may take it early
  (`lockInternalUserSeats`) and then call the check.

## Paths covered

Each runs check, write and any token consumption in one transaction:

| Path | Where |
| --- | --- |
| `UserService.create` / `createInTransaction` | `UserService.createUsingTransaction` |
| `addUser` | `userActions.ts` |
| Reactivation via `updateUser` | `userActions.ts` (only the inactive to active transition) |
| `UserService.update` (REST `PUT /users/:id`): reactivation, client to internal | `UserService.ts` |
| `UserService.bulkDeactivateUsers(..., false)`: one-by-one, all-or-nothing | `UserService.ts` |
| Invitation send (reservation) | `userInvitationActions.ts` |
| Invitation accept (check, account, role, token consumption) | `userInvitationActions.ts` |
| Co-managed invitation accept | `UserService.createFromCoManagedInvitation` |
| EE SCIM reactivation | `ee/server/src/lib/scim/service.ts` `applyLifecycle` |

The `UserService.update`, bulk activation and SCIM reactivation rows were found during
the coverage audit and added after the first commit.

### `coManagedAdmitted` bypass

`createUsingTransaction(..., coManagedAdmitted = true)` skips the generic check. Its
only caller is `createFromCoManagedInvitation`, which runs
`assertCoManagedSeatAdmission` (allocation accounting) in the same transaction. It now
also takes the seat lock explicitly, before the admission's row locks, so it no longer
relies on the caller having locked.

## Transaction boundaries

- **Invitation send.** One transaction: lock, count other pending invitations,
  seat check, co-managed admission, invitation row. It **commits before** the
  outbound email, so the lock is never held across a network call. If the email fails,
  the invitation created by this call is deleted to release the reservation.
- **Invitation accept.** One transaction: seat check, role check, user insert, role
  assignment, `used_at` update. A failure anywhere rolls back all of it, so the token
  is never spent without an account and an account is never created without spending
  the token.

## Tripwire versus mechanism

`assertInternalUserSeatsWithinLimit` recounts after the write, in the same transaction,
and throws to roll back. It is a backstop for a path that forgot the lock. It is **not**
the mechanism: under READ COMMITTED, two unlocked writers each see only committed rows,
so the tripwire does not catch their race (the no-lock runs above show it passing all
8). Correctness comes from the lock.

## Lock order

Every seat path takes the seat lock first, then row locks. Co-managed admission and SCIM
reactivation were arranged to follow this (SCIM takes the seat lock before
`FOR UPDATE` on the user row). Deactivate, role change, licence-count edits and
invitation revoke do not take the seat lock, so they cannot invert. Co-managed
provisioning and allocation changes take only their own row locks, never the seat lock.

## `lock_timeout`

`app_user` has `lock_timeout = 8s` (migration 20260609120000). A request queued behind
the seat lock longer than that fails closed with an error (HTTP 500). That is accepted;
the timeout is not changed.

## Out of scope

Count-constraint triggers, denormalized seat counters, licence-policy changes, and
the new-tenant admin bootstrap in `ee/temporal-workflows` (no prior users, single
actor). MCP agent service users (`ee/server/src/lib/mcp/agents.ts`) are inserted as
`internal` and count as seats; changing that is a licence-policy question.

## Known residuals

- A failed invitation resend rotates the token, so the old link stays dead until the
  admin retries.
- `isCoManagedInvitationServed` runs while the seat lock is held (accept path and send
  path), so its latency extends the queue for that tenant.
- `updateUser` reads the stored row before taking the lock; a concurrent deactivation
  between that read and the write is treated conservatively at worst.

## Tests

`server/src/test/integration/internalUserSeatLock.integration.test.ts` (real Postgres):
8-way `UserService.create` race (blocked behind an `ACCESS EXCLUSIVE` holder until all 8
backends are confirmed waiting), concurrent `UserService.update` reactivation race,
client to internal and bulk activation refusal, `reservedSeats`, solo plan,
`deferCoManaged`, non-transaction caller, two-tenant independence, tripwire.
Unit tests: `packages/users/src/lib/internalUserLicenseGuard.test.ts`,
`userActions.test.ts`, `userActionsAddUserTenantScoped.contract.test.ts`.
