# Contract bucket usage error — implementation plan

Ticket: **alga0002175** — "Error when allocating time to bucket".
Branch: `fix/contract-bucket-usage-error`.
Date: 2026-07-25.

## Problem

A contract is configured with 7 hours included at one rate and overage above
that at a higher rate. Saving a manual time entry against that service fails
with:

> Unable to update bucket usage for this time entry. Please refresh and try again.

Time entry against a service with no bucket works. Recreating the contract from
scratch reproduces the same error.

## Root cause

Confirmed against production data.

`findOrCreateCurrentBucketUsageRecord` resolves the bucket configuration in two
steps. First it finds the configuration row
(`shared/billingClients/bucketUsageService.ts:356`):

```js
const planServiceConfig = await db.table('contract_line_service_configuration')
    .where({ contract_line_id: planId, service_id: serviceCatalogId })
    .first<{ config_id: string }>();
```

Then it loads the bucket detail row for that `config_id` (line 367), and throws
if there isn't one (line 375).

The first query omits `configuration_type` and has no `ORDER BY`. The data model
deliberately allows **several configuration rows per (contract line, service)**,
one per `configuration_type`, each with its own detail table — see
`packages/billing/src/repositories/contractLineRepository.ts:363-410`, which
loops over configurations for a single service and clones a
`..._bucket_config` or `..._hourly_config` row per configuration. So the query
selects an arbitrary row from a set that legitimately holds more than one, and
when it returns a non-bucket row the detail lookup finds nothing and throws.

The reproducing shape is a contract line holding two configuration rows for one
service:

| configuration_type | bucket detail row |
| --- | --- |
| Bucket | yes |
| Hourly | no |

An Hourly line with a Bucket overlay — "7 hours included, overage above that" —
*is* two configurations on one line. A service with no bucket has one
configuration and the caller's guard skips the block entirely, which is why that
case works. In the reporting tenant no `time_entries` row had ever been written:
every attempt had failed.

Everything else on the path was healthy and was ruled out by inspection:

- Assignment resolution succeeds: the client contract is active, starts before
  the entry date, and has no end date.
- `billing_frequency` is `monthly`; `total_minutes` is 420 (= 7 hours), and an
  overage rate is set.
- A `recurring_service_periods` row covers the entry date, so period calculation
  succeeds.
- Only one active assignment matches, so the ambiguity guard at line 183 does
  not fire.

Production logs (Loki, incident window) confirm the mechanism directly: every
failed save threw `Bucket configuration not found`, and the named `config_id`
was a **non-Bucket** configuration row — the Hourly row on the live line for the
final attempts, and a Usage row on an earlier attempt, proving the defect is
wrong-type selection generally rather than anything Hourly-specific. The
earliest failures show one further variant: a Bucket configuration row whose
detail row did not exist yet (a half-saved configuration, completed by a later
re-save). That variant produces the same user message and maps to
`MISSING_BUCKET_CONFIG` in the new error taxonomy, whose "re-save the bucket
configuration" guidance is exactly the action that cures it.

### Why the report was undiagnosable

`timeEntryCrudActions.ts:742-746` catches any bucket failure and rewraps it as a
generic `Bucket usage update failed …`. `timeSheetActionErrors.ts:47` then
matches that string and returns one fixed sentence. Four distinct causes —
no active line, ambiguous assignment, missing bucket config, unsupported
frequency — reach the user as the same words. Identifying this one needed a
production database session.

### Blast radius

The defect is not tenant-specific. Fleet-wide, **18 (contract line, service)
pairs across roughly 10 tenants** carry a Bucket configuration alongside another
type, and every one can fail the same way. Which row Postgres returns is not
guaranteed stable across plans, statistics or row churn, so a tenant that works
today can start failing without any change on their side.

Two smaller findings in the reporting tenant, neither a cause of the error:

- **2 detached contract lines** with `contract_id = NULL` and
  `is_template = false`. Initially read as damage from the recreate attempts;
  investigation showed they are the deliberate output of removing a line from a
  contract. See "Detached contract lines" under follow-ups. Note that
  `contract_id = NULL` is also legitimate for template lines — 53 exist
  fleet-wide — so any detection must filter on `is_template = false`. Twelve
  detached lines exist across five tenants.
- **Duplicate Bucket configurations** on one line (two Bucket rows for one
  service). This is the only such duplicate fleet-wide, and it sits on one of
  the detached lines.

Neither blocks the reporter once the lookup is fixed; the live line is clean.

## Scope

In scope: the lookup fix, distinguishable errors on the bucket path, regression
coverage, and a post-deploy fleet audit.

Out of scope, recorded as follow-ups below: the `weekly` billing-frequency gap,
a uniqueness constraint on configurations, and cleanup of detached contract
lines.

**The detached-line repair script was dropped after investigation** — see
"Detached contract lines" under follow-ups. The rows are not corruption and are
harmless; the code fix alone resolves the ticket.

## Work items

### 1. Qualify the bucket configuration lookup

`shared/billingClients/bucketUsageService.ts:356`

Add `configuration_type: 'Bucket'` to the `where` clause, and order by
`created_at` ascending so the choice is deterministic if two Bucket rows ever
coexist. The type filter is the fix; the ordering removes the residual
nondeterminism.

Update the header comment (lines 1-18), which already warns against re-deriving
contract-line ownership, to also state that any lookup of
`contract_line_service_configuration` on this path must qualify by
`configuration_type` — a line and service can carry several.

### 2. Qualify the sibling joins

`updateBucketUsageMinutes` (line 534) and `reconcileBucketUsageRecord`
(line 603) join `contract_line_service_configuration` on the same key without
the type qualifier. Both are currently safe by accident: their inner join to
`contract_line_service_bucket_config` discards non-bucket rows.

Add the explicit `configuration_type = 'Bucket'` condition to both joins. No
behavior change today; it removes a trap for the next edit and makes all three
call sites read consistently.

### 3. Make bucket failures distinguishable

New module `shared/billingClients/bucketUsageErrors.ts`:

- `BucketUsageError extends Error`, carrying a `code` and a `details` bag of
  identifiers (tenant, client, contract line, service, date).
- Codes: `NO_ACTIVE_CONTRACT_LINE`, `AMBIGUOUS_ASSIGNMENT`,
  `MISSING_BUCKET_CONFIG`, `MISSING_PLAN_SERVICE_CONFIG`,
  `UNSUPPORTED_BILLING_FREQUENCY`.
- `isBucketUsageError(value): value is BucketUsageError`.

Throw it in place of the bare `Error`s at `bucketUsageService.ts` lines 184
(ambiguous), 276 and 441 (unsupported frequency), 329 (no active line), 364
(missing plan service config) and 375 (missing bucket config). Messages keep
their current detail for the server log.

The two call sites that rewrap — `timeEntryCrudActions.ts:745` and `:1104`, and
`usageActions.ts:138`, `:260`, `:332` — must preserve the code. Rethrow the
`BucketUsageError` unchanged, or wrap with `{ cause }` and have the guard
unwrap; do not flatten it into a string.

In `timeSheetActionErrors.ts` and `usageActions.ts:38`, check
`isBucketUsageError` **before** the existing string matches and map each code to
an actionable sentence:

| Code | User-facing message |
| --- | --- |
| `NO_ACTIVE_CONTRACT_LINE` | No active contract covers this date for this client and service. Check the contract's start date and that it is active. |
| `AMBIGUOUS_ASSIGNMENT` | More than one active contract gives this client a bucket for this service. End-date or deactivate the duplicate. |
| `MISSING_BUCKET_CONFIG` / `MISSING_PLAN_SERVICE_CONFIG` | This contract line's bucket settings are incomplete. Re-save the bucket configuration on the contract line. |
| `UNSUPPORTED_BILLING_FREQUENCY` | Bucket billing does not support this contract line's billing frequency. |

Keep the existing string-matching fallback so any unconverted throw still maps
to the current generic message. This follows the repo's failure-handling
philosophy — fail fast with actionable, descriptive messages
(`docs/AI_coding_standards.md:10-14`).

### 4. Tests

**Unit** — `server/src/test/unit/bucketUsageService.test.ts` already mocks the
transaction and records `whereCalls`, which is exactly the hook needed. Add:

- A configuration set containing both a Bucket row and an Hourly row for one
  (line, service), asserting the returned `config_id` is the Bucket one. This
  test fails before the fix.
- An assertion that the `contract_line_service_configuration` query includes
  `configuration_type: 'Bucket'`.
- One test per `BucketUsageError` code, asserting the code rather than the
  message text.

**Integration** — `server/src/test/integration/bucketUsageIntegration.test.ts`:
build an Hourly contract line with a Bucket overlay on the same service, save a
billable time entry, and assert it persists and `bucket_usage.minutes_used`
increments by the entry's billable minutes. This is the reported shape and no
existing test covers it.

**Mapper** — assert each code maps to its distinct message and that an unknown
error still falls through to the generic text.

## Verification

1. Unit and integration suites above pass; the new unit test is confirmed to
   fail against the unfixed lookup.
2. On the local stack, rebuild the reported configuration — Hourly line, 7-hour
   bucket overlay, higher overage rate — and save a manual time entry on a
   ticket. It saves, and `bucket_usage` shows the minutes.
3. Log a second entry that crosses the 420-minute threshold and confirm
   `overage_minutes` is the excess.
4. Post-deploy, re-run the fleet audit query (Bucket plus another type per line
   and service) and confirm a time entry succeeds for at least one previously
   affected tenant besides the reporter's.
5. Confirm the live contract line and its Bucket config are untouched
   throughout.

## Follow-ups (not in this branch)

- **`weekly` billing frequency**: the UI offers it
  (`packages/billing/src/constants/billing.ts:15`) but `calculatePeriod`'s
  switch handles only monthly, quarterly and annually and throws on anything
  else (`bucketUsageService.ts:276`). A weekly bucket line can never record
  time. Worth its own ticket.
- **Uniqueness**: no constraint stops duplicate configurations per
  `(tenant, contract_line_id, service_id, configuration_type)`. Exactly one
  violation exists fleet-wide, so the data is clean enough to add one.
- **Detached contract lines** (investigated 2026-07-25; no action taken).
  Removing a line from a contract is implemented as an *unlink*:
  `ContractLineMapping.removeContractLine`
  (`packages/billing/src/models/contractLineMapping.ts:226-235`) sets
  `contract_id = NULL`, clears `custom_rate`, and leaves the line, its
  configurations, services and schedules in place. This is deliberate, not a
  stranding bug. No code anywhere filters `contract_id IS NULL` on
  `contract_lines`, so detached lines are never listed or offered for re-attach
  — they are unreachable dead rows that accrue on every line removal (12 across
  5 tenants, accumulating steadily since 2025-12).

  A cleanup script was planned and then dropped: nothing billable is attached to
  any of them (zero `bucket_usage`, `usage_tracking`, `time_entries` and
  `contract_line_discounts` rows), and users cannot see them, so they are
  harmless. Two things a future cleanup must get right, both discovered while
  scoping it:
  - `bucket_usage` and `usage_tracking` are **`ON DELETE CASCADE`** from
    `contract_lines`. A naive delete silently destroys usage and billing
    records. Seven tables reference `contract_lines`; six reference
    `contract_line_service_configuration` (bucket, fixed, hourly, hourlys,
    rate_tiers, usage) — not the two a first pass assumes.
  - `recurring_service_periods` has **no foreign key** — `obligation_id` is
    loose — so it never cascades and must be cleaned explicitly. 99 such rows
    currently point at detached lines across 3 tenants; these are the only
    residue with a plausible ongoing effect.

  The better fix is probably at the source: have line removal clean up after
  itself, or mark the line inactive so it stops generating service periods.
  That is a product decision about contract editing and belongs in its own
  ticket.
- **Bad template values**: one template line in the reporting tenant has
  `total_minutes = 7`, i.e. 7 minutes where 7 hours (420) was meant. It will
  propagate to any contract created from it. Customer data, but worth flagging
  in the ticket reply.

## Notes for the ticket reply

The reported configuration was correct throughout; recreating the contract was
never going to help, because the failure is in how the application resolves a
bucket overlay, not in what was configured. A 420-minute bucket with a higher
overage rate is exactly right.
