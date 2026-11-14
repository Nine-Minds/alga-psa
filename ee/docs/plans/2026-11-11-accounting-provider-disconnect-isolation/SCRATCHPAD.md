# Accounting provider disconnect isolation: investigation notes

## Production evidence collected on 2026-11-11

All timestamps below are UTC. Evidence came from Discord review, centralized Loki logs, and read-only queries against the production database. Customer names, message contents, tenant IDs, realm IDs, and connection IDs are intentionally omitted.

- The affected tenant connected Xero on October 15. It had 541 successful Xero cycles, with the last success on October 31. This was a real historical connection, not a disconnect record created for every tenant.
- QuickBooks had 1,158 successful cycles. Its last success was November 8 at 17:00. Subsequent runs included 196 aborted cycles and one failed cycle.
- The most recent QuickBooks cycle started November 10 at 18:15:04.536 and ended at 18:15:05.144 with `Failed to refresh QBO token. Please re-authenticate.`
- At November 10 18:16:53, Intuit rejected token refresh with HTTP 400, `invalid_grant`, and `Incorrect or invalid refresh token`. Why the original token became invalid remains unknown.
- A Xero disconnect started November 10 at 18:16:42.933. Its sole target became `failed_permanent` with `xero_http_403`, attempt count 1, no next retry, and no finalization timestamp.
- QuickBooks reconnections were audited November 10 at 18:19:01, 18:20:08, and 20:12:51, and November 11 at 08:51:53.
- On November 11 at 16:32:02, QuickBooks token refresh succeeded for the same tenant and realm. Company/catalog queries subsequently succeeded. This proves access worked after reconnect; it does not prove that a full accounting sync ran.
- At November 11 17:15:08, the scheduled handler logged `Cycle skipped: provider disconnect in progress` for the affected tenant, with `qboBlocked: false` and `xeroBlocked: true`.
- `tenant_settings.settings.accountingSync.autoSyncEnabled` was true. Neither provider had a newer cycle than November 10 at 18:15. The sync panel therefore continued showing the historical QuickBooks error.
- Across the production disconnect table, one record was non-finalized: the affected Xero record. Three other records were finalized, including one older Xero HTTP 403 case. At the investigation snapshot, six other QBO tenants and three Xero tenants completed successful cycles at November 11 17:30, each with four cycles in the preceding hour. The observed blocker was tenant-specific; the code defect can affect any tenant with the same state.

## Code findings

- `server/src/lib/jobs/handlers/accountingSyncCycleHandler.ts`: reads both provider states, then returns from the entire tenant job on `qboBlocked || xeroBlocked`, before enumerating targets.
- `packages/billing/src/actions/accountingSyncActions.ts`: `assertNoActiveProviderDisconnect(tenantId)` checks both providers before target resolution. Used by `runAccountingSyncNow`, `queueInvoiceSync`, and `resolveAccountingDriftReExport`. These interactive paths have the same structural defect; they were identified by code inspection, not exercised against production.
- `packages/integrations/src/lib/providerDisconnect/status.ts`: `isProviderDisconnectActive` correctly treats every non-finalized record, including `failed_permanent`, as a blocker for that provider.
- `packages/integrations/src/lib/providerDisconnect/types.ts`: canonical provider IDs are `quickbooks_online` and `xero`. Do not introduce `qbo` as another runtime provider ID.
- `packages/billing/src/services/accountingSync/syncTarget.ts`: shared target selection used by interactive actions. Explicit organisation selection must not silently fall back to another target when credentials are tombstoned.
- `packages/billing/src/services/accountingSync/syncCycleRepository.ts`: latest stored cycle supplies the historical result.
- `packages/billing/src/components/accounting/QboSyncHealthPanel.tsx`: renders the most recent stored cycle; its stale error in this incident follows from no new cycle running.
- `server/src/test/unit/accountingSyncCycleHandler.unit.test.ts`: existing runtime tests cover multiple Xero organisations and both providers, but not asymmetric disconnect states. Its provider mock currently uses `qbo`; align fixtures with the canonical provider ID when extending coverage.

## Query and verification recipes

- Loki selector: `{namespace="msp",pod=~"sebastian-.*"}`. Search literal code messages `Cycle skipped: provider disconnect in progress`, `Error refreshing QBO token`, `Successfully refreshed QBO token.`, and `QBO query succeeded`.
- App log objects span multiple lines. Read the same pod and a narrow timestamp window to attribute the tenant, realm, provider response, and message. Do not attribute a standalone message from another tenant's nearby request.
- Inspect `provider_disconnect_records` for `provider`, `status`, `last_error_class`, `attempt_count`, `next_retry_at`, and `finalized_at`.
- Compare `accounting_sync_cycles` by tenant and adapter type with `tenant_settings.settings.accountingSync` and lifecycle entries in `audit_logs`.
- Scope checks should count all non-finalized disconnect records and compare recent cycle successes across both providers. Missing new errors alone does not prove recovery.
- The log-analysis skill's `obs-query.sh logs` parser failed locally with a Python f-string syntax error. An existing app pod running a small Node HTTP request to Loki worked. Avoid copying raw provider errors or credentials into investigation artifacts.

## Implementation decisions

- Keep the existing disconnect state machine. A permanent failure still blocks its own provider until the existing explicit recovery flow completes.
- Apply the blocking decision to a tenant/provider target, rather than the whole tenant. Reuse a provider-scoped guard across scheduling and interactive mutations where appropriate.
- Do not make Xero HTTP 403 mean successful revocation or automatically delete its record. That would weaken the existing cleanup contract.
- No production state was changed during the investigation. Any operational cleanup is separate from this card's code change and must use the existing authorized disconnect recovery path.

## Open investigation boundaries

- The original reasons for the invalid QuickBooks refresh token and Xero HTTP 403 are not established. Neither is needed to prove the cross-provider guard defect.
- Revalidate the production scope and latest cycle after deployment; these counts are a snapshot, not a standing claim about all tenants.
