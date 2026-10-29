# Design — "add service" must authorize against the membership it actually writes

Card `f1526cf7` — Security: authz in `addServiceToContractLine` (finding from PR #3974, merge `450e05f46b19`).

## The finding, confirmed

`addServiceToContractLine` (`packages/billing/src/actions/contractLineServiceActions.ts:275`) checks only
`billing:create` before accepting caller-controlled `quantity`, `custom_rate`, configuration type, type
configuration and rate tiers. It then calls the membership helper
(`packages/billing/src/lib/billing/contractLineMembership.ts:262-285`), which:

- reads `contract_line_services`; if the row is absent it inserts it — a **create**;
- then reads the service configuration; if one exists it calls `updateConfiguration(existingConfig.config_id, …)`
  with the caller's values — an **update** that the create-only check never covered.

So a user with `billing:read/create` and no `billing:update` "adds" a service that is already attached and
rewrites its quantity, rate, pricing basis and rate tiers. The action name says create; the write says
update. Pre-existing behaviour, moved into the new membership module by #3974.

## The rule (shared with card `f2aac11d`)

> **The permission is derived from the rows the transaction will create or modify, not from the action's name.**

Classification, in the shared helper:

- membership absent **or** configuration absent → the call will create one of them → `billing:create`
- membership present **and** configuration present → the call only modifies them → `billing:update`

## Mechanism

`contractLineMembership.ts` gains the shared classifier described on `f2aac11d`:

```ts
export async function authorizeMembershipWrite(
  trx, tenant, user, contractLineId, serviceId,
): Promise<{ membershipExists: boolean; configurationExists: boolean }>
```

It locks the contract line row (`FOR UPDATE`), reads the membership and configuration, requires
`billing:create` if either is missing else `billing:update`, and throws the module's typed permission
error otherwise.

`addServiceToContractLineInTransaction` calls it as its **first** statement, before the existing-membership
upsert, and keeps the upsert behaviour it has today: an already-attached service stays an upsert (the
shared add-service UIs rely on that), it just requires `billing:update` now. The helper returns the two
booleans so the caller does not re-read state it has already read under the lock.

The action wrapper (`contractLineServiceActions.ts`) keeps its `billing:create` fast-fail? **No** — remove
it. It is the finding: a single declared check that does not cover the write. One authority: the helper.
Callers that need a cheap pre-check keep the `withAuth` read gate only.

## Why not "reject existing memberships from the add action"

The finding offers that alternative. Rejected because: the UI's add-service flow is genuinely an upsert
(it is how a service already on the line gets priced), so rejecting would move the work to another action
without changing who can do what, and would break legitimate create-then-price flows for bulk imports.
Requiring `billing:update` for the update half is the smaller rule and states the truth.

## Tests

`packages/billing/src/actions/__tests__/contractLineServiceActions.authz.test.ts` (new):

1. create-only user, service **already attached with a configuration** → rejected; configuration values
   unchanged in the database. *Fails before the fix — the regression.*
2. create-only user, service **not attached** → succeeds; membership and configuration created.
3. update-only user, service already attached **without** a configuration → rejected (the call would
   create the configuration; create is required); no configuration row appears.
4. update-only user, attached **with** configuration → succeeds.
5. `authorizeMembershipWrite` unit test: refusal message names the service and the required permission;
   tenant scoping keeps another tenant's line invisible.
6. Concurrency: two transactions on the same line — second observes the first's membership (line lock),
   never double-inserts.

## Not doing

- No signature or payload change for API/MCP consumers.
- No change to `removeServiceFromContractLine` or the bulk `applyContractLineServiceMembershipChanges`
  beyond what the shared helper already gives them when they touch individual memberships.
- No UI work: the add-service dialog is unchanged; its permission-gated visibility already follows the
  user's rights.

## Order of work

1. Shared classifier (lands with the `f2aac11d` change — same commit shape, separate card/branch).
2. Call it at the top of `addServiceToContractLineInTransaction`; drop the declared create check in the action.
3. Tests 1-6; billing suite + `tsc`.
4. `security-finding-resolved` evidence: test 1 before/after, test 2 proving the legitimate create path.

## Risks

- **Behavioural tightening**: create-only integrations that genuinely used "add" on an existing service
  will now be refused. That is the fix; call it out in the PR body so reviewers do not read it as a
  regression.
- **Two reads of configuration** (classifier + `getConfigurationForService`). Acceptable: both inside the
  same transaction, and the classifier's copy exists to authorize, not to be reused.
- If `contract_line_services` has no configuration yet in production data, test 3 becomes the common path —
  worth checking the counts during implementation.
