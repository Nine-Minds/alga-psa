# PRD — Isolate accounting sync from other providers' disconnects

- Slug: `accounting-provider-disconnect-isolation`
- Date: `2026-11-11`
- Status: Draft

## Summary

A disconnect for one accounting provider must pause only that provider. A tenant with healthy QuickBooks access must continue syncing while Xero cleanup is pending or permanently failed, and the same rule must hold in the reverse direction.

## Problem and findings

The scheduled accounting handler checks QuickBooks and Xero disconnect records together. If either is non-finalized, it returns before processing any connected target. Three interactive mutation actions use the same tenant-wide guard.

Production investigation found one tenant with a Xero disconnect stuck in `failed_permanent` after HTTP 403. Its QuickBooks reconnection and subsequent token refresh and API queries succeeded, but scheduled cycles still stopped with `qboBlocked: false` and `xeroBlocked: true`. Automatic sync was enabled. The panel retained the older token-refresh error because no newer cycle ran.

The affected tenant had previously connected and successfully synced Xero. At the investigation snapshot, it was the only tenant with a non-finalized disconnect record. Six other QuickBooks tenants and three Xero tenants continued successful scheduled cycles. This is a reusable product defect triggered by a particular disconnect state, not an observed global accounting outage. The sanitized timeline and code references are in `SCRATCHPAD.md`.

## Goals

1. Keep each provider's disconnect boundary independent in scheduled and interactive sync.
2. Preserve blocking for every non-finalized disconnect state on the affected provider.
3. Resume healthy-provider cycles on the next scheduled tick without reconnecting or changing the other provider's state.
4. Preserve explicit provider/organisation selection, tenant isolation, and existing accounting permissions.

## Non-goals

- Redesigning OAuth refresh, provider revocation, or the disconnect state machine.
- Treating HTTP 403 as successful revocation, automatically force-finalizing records, or deleting production state.
- Changing the 15-minute schedule, sync settings, accounting operation semantics, or historical sync records.
- Adding a new dashboard, monitoring system, feature flag, or UI redesign.
- Establishing why the original QuickBooks refresh token became invalid or why Xero returned HTTP 403.

## Users and primary flows

MSP administrators may connect both accounting providers while evaluating or migrating integrations. They disconnect one provider and continue using the other.

For scheduled execution, the job evaluates each provider independently and runs every eligible connected target. For interactive execution, the user selects a provider/organisation and runs Sync Now, queues an invoice sync, or requests a drift re-export. Only that provider's disconnect status governs the action. A blocked explicit selection produces an actionable result without switching organisations.

## Requirements

### Provider-scoped eligibility

- Express disconnect eligibility in terms of the canonical tenant/provider identity. Use the existing `quickbooks_online` and `xero` identifiers and existing status semantics.
- A `pending_revocation` or `failed_permanent` record blocks only its own provider. No record or a `finalized` record does not impose a disconnect block.
- Prefer one provider-scoped guard/policy composed by callers over parallel ad hoc checks. Do not add flags, customer exceptions, or a second disconnect state machine.
- Preserve the existing credential tombstone and persistence-time checks. Narrowing the outer guard must not reopen the disconnecting provider to sync/export.

### Scheduled execution

- Remove the tenant-wide early return. Evaluate provider eligibility independently while building/processing the existing provider targets.
- Continue all eligible realms/organisations for the unblocked provider when the other provider is blocked, including when the blocked provider's credential getter returns an empty map.
- When both providers are blocked, run neither. A tenant with no targets remains a cheap no-op. Keep CE gating and the automatic-sync setting behavior.

### Interactive mutations

- Apply provider-scoped guarding to `runAccountingSyncNow`, `queueInvoiceSync`, and `resolveAccountingDriftReExport`.
- Determine the intended provider from the explicit selection or established default-resolution rules before enforcing its disconnect boundary.
- Preserve actionable disconnect errors even when the selected provider's credentials are tombstoned and ordinary connection resolution returns no target. Never fall back from an explicit blocked or missing selection to another provider or organisation.
- Preserve all existing permissions and tenant-scoped queue writes. Do not enqueue or invoke a cycle for the blocked provider.

### Recovery and displayed history

- A healthy provider resumes through normal scheduling. A successful cycle replaces the old error as the most recent cycle shown by the existing panel.
- Preserve previous failed/aborted cycles as history. Do not clear an error merely because OAuth reconnect completed; a full sync has to run to establish its own outcome.
- Keep the failed disconnect available to the existing explicit recovery flow. Operational recovery of that record is separate from code delivery.

## UX / UI notes

Use the existing accounting connection and sync panels. Provider-specific disconnect feedback must name the selected provider. No new screen or copy expansion is required. Validate the historical-error-to-new-cycle transition through the running application after a healthy-provider cycle actually completes.

## Data / API / integrations

No migration or new endpoint is expected. Use `provider_disconnect_records`, `accounting_sync_cycles`, existing accounting settings, and existing provider credentials/target selection. Real DB integration tests must exercise the migrated schema for both an eligible path and a blocked-provider path. Mock external provider APIs at the adapter boundary, not the database behavior under test.

## Security / permissions

Keep connection-management and exports-execution checks intact. A disconnect record in another tenant must never affect the selected tenant. Preserve same-provider tombstones and disconnect race protections. Do not log tokens, credentials, or raw provider response objects.

## Rollout / migration

Deliver as one pull request. No data rewrite is needed to restore the unrelated healthy provider. After deployment, recheck provider-scoped skip/run results and the creation of a newer cycle for the previously blocked healthy provider. Separately inspect the failed provider's cleanup through its existing recovery workflow; this card does not authorize production changes.

## Risks and open questions

- Guarding only after ordinary target resolution could replace a useful disconnect error with a misleading not-connected message. Resolve intent and preserve the existing provider-specific feedback.
- An overly broad fix could bypass the disconnecting provider's credential tombstone. Test both directions and both non-finalized statuses.
- Inspect shared lower-layer guards and existing race protections during implementation. Broader unrelated accounting refactors remain outside this plan.
- The root causes of the upstream token rejection and HTTP 403 remain unknown and separate from the proven scheduling defect.

## Acceptance criteria

1. With Xero blocked, connected QuickBooks targets run on schedule and all three interactive mutation actions remain usable for QuickBooks. The reverse direction behaves identically.
2. Neither non-finalized disconnect state permits a cycle or queued export for its own provider. Both blocked providers yield no work.
3. Explicit blocked/missing organisation selection never selects another organisation as a fallback.
4. Both unblocked providers retain multi-target execution, permissions, tenant isolation, auto-sync settings, and CE behavior.
5. A newer actual sync result replaces the historical error through the existing health query and panel behavior, without deleting history or requiring unrelated disconnect finalization.
6. Runtime regression coverage and a minimal real-DB happy-path/guard suite pass. No source-string or import-presence assertions substitute for behavioral coverage.
