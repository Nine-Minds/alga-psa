# Plan: Entra shared mailboxes stay inactive after a CIPP detection outage

- Card: alga-2026-0002578 follow-up (C1), project `15cc24b0-eac9-4417-bdbd-a522f93cb0ba`
- Branch: `feature/entra-shared-mailboxes-stay-inactive-after-cipp` (stacked on the user-sync filter branch)
- Author: XO conn design desk, 2026-09-27, on captain order "create a plan for this and then advance"
- Parent ruling/spec: fact "Shared-mailbox ruling (captain, 2026-09-24)" on card 9927c0fb; addendum `docs/plans/2026-09-23-entra-user-sync-import-filter-plan.md`

## Problem

When CIPP cannot classify mailboxes (`listSharedMailboxIds` returns `null` on
401/403/404/timeout or an unrecognised payload — `cippProviderAdapter.ts:197-233`),
the filter pipeline never sets `mailboxKind='shared'`, so a shared mailbox
(`accountEnabled=false`) is excluded with reason `account_disabled`
(`userFilterPipeline.ts:106-116`). Those identities become `disabledIdentities`
and the sync marks their contacts `is_inactive=true`,
`entra_sync_status_reason='disabled_upstream'` (`syncEngine.ts:321-353`,
`disableHandler.ts:148-157`). Because `disabled_upstream` is never
auto-reactivated (`reactivateExcludedEntraContact` only handles
`excluded_by_filter`, `contactReconciler.ts:282-289`), a temporary CIPP
permission/detection problem permanently retires deliberately-imported shared
mailboxes. Confirmed live: Northwind "Shared Mailbox" contact is
`is_inactive=true / disabled_upstream`, and the preview counted NW Reception
and NW AP as `account_disabled`.

## Design decisions

- **D1 — Detection-unavailable must not deactivate a known shared mailbox.**
  When `sharedMailboxIds === null`, mailboxKind is unknowable from the provider,
  but the persisted `contacts.contact_kind='shared_mailbox'` records the prior
  ruling. Filter the `disabledIdentities` candidates to drop any whose linked
  contact is `contact_kind='shared_mailbox'`. Keep the existing "detection
  unavailable" warning surfaced (`settingsService.ts:66`).
- **D2 — Guard the write path too (defense in depth).** The preview and the
  real inactivation (`selectLinkedEntraIdentities` + `markDisabledEntraUsersInactive`)
  must independently skip contacts whose `contact_kind='shared_mailbox'`, so the
  invariant holds no matter which producer built `disabledIdentities`.
- **D3 — Narrow recovery reactivation.** When detection succeeds and a user is
  `included` with `mailboxKind='shared'` (only possible when
  `importSharedMailboxes` is on), reactivate a linked contact that is inactive
  with `entra_sync_status_reason='disabled_upstream'` **and**
  `contact_kind='shared_mailbox'`. Add a sibling to
  `reactivateExcludedEntraContact` and invoke it at the same three call sites
  (`syncEngine.ts:174` dry-run, `:194` real linked, `:260` created→linked),
  counting it as `updated` so the preview matches the write.
- **D4 — Exactly one reason + one kind.** The exception is limited to
  `disabled_upstream` + `shared_mailbox`. Person contacts and every other
  reason keep today's "never auto-reactivate" behaviour.

## Implementation order

1. `ee/server/src/lib/integrations/entra/providers` / sync: add a small
   DB-aware helper (in `disableHandler.ts`) that, given identity refs, returns
   those whose linked contact is **not** `contact_kind='shared_mailbox'`.
   Reuse it to filter `disabledIdentities` in **both** producers:
   `preflightService.ts:210-218` and
   `ee/temporal-workflows/src/activities/entra-sync-activities.ts:396-420`.
2. Harden the write/preview path in `syncEngine.ts:321-353`: skip
   `shared_mailbox` contacts in the dry-run loop (`selectLinkedEntraIdentities`
   path) and in `markDisabledEntraUsersInactive` (`disableHandler.ts:148-157`).
3. Add `reactivateDisabledSharedMailboxContact(tenantId, contactNameId, dryRun)`
   next to `reactivateExcludedEntraContact` (`contactReconciler.ts:282`):
   reactivate only when `entra_sync_status_reason='disabled_upstream'` and
   `contact_kind='shared_mailbox'`; clear reason, set active fields as the
   existing helper does.
4. Call it at `syncEngine.ts:174/194/260` **only when**
   `userWithEntitlement.mailboxKind === 'shared'`, incrementing `updated` on a
   real change and mirroring that in the dry-run count.
5. Tests (below). No new migration — `contact_kind` already exists
   (`server/migrations/20260924120000_add_contact_kind.cjs`).

## Tests

- Unit — pipeline/preflight: with `sharedMailboxIds === null` (403 mode), a
  linked contact with `contact_kind='shared_mailbox'` is **absent** from
  `disabledIdentities` and from the `mark_inactive / disabled_upstream` preview;
  a genuinely disabled **person** contact is still present.
- Unit — syncEngine: real run does not set `disabled_upstream` on a
  `shared_mailbox` contact under detection-unavailable, and the dry-run count
  matches the write count.
- Unit — recovery: detection recovered + `importSharedMailboxes` on reactivates
  an inactive `disabled_upstream` `shared_mailbox` contact (`updated` counted);
  a `disabled_upstream` **person** contact stays inactive (negative).
- Integration — extend `ee/server/src/__tests__/integration/entraUserFilters.integration.test.ts`
  with a 403-fallback-then-recovery cycle asserting the contact ends active and
  a person contact is untouched.
- Keep green: `entraProviderAdapterSeams.test.ts` (403 → `null`),
  `entraPreflightService.test.ts`, `entraSyncEngine.dryRun.test.ts`,
  `entraDisableHandler.test.ts`.

## Non-goals

- No change to the shared-mailbox ruling or the `importSharedMailboxes` default
  (`userFilterConfig.ts:15`).
- No auto-reactivation of `disabled_upstream` for person contacts or any other
  reason.
- No change to CIPP 403/404 handling (still treated as detection unavailable).
- No backfill of `contact_kind` for legacy shared mailboxes (see Risks).

## Risks / open items

- Flapping detection could oscillate state, but the change only ever moves a
  `shared_mailbox` toward active and never deactivates one on an unavailable
  run; net effect is safe.
- Legacy shared mailboxes imported before `contact_kind` existed may have a null
  kind and would still be deactivated on an outage. Out of scope; note as a
  follow-up if the Northwind fixture shows a null kind.

## Evidence required from Draft Implementation

- The added/updated unit + integration tests pass; `server` and `ee` typechecks
  pass; no new migration; the Northwind "Shared Mailbox" fixture is active after
  a simulated 403→recovery cycle.
