# PRD — Entra connection diagnostics

- Slug: `2026-09-16-entra-connection-diagnostics`
- Date: 2026-09-16
- Status: Planned from the commissioning brief; implementation pending
- Owning areas: EE Entra integration, shared diagnostics, integrations UI, Microsoft Graph emulator, website documentation

## Summary

Give an MSP operator an on-demand, read-only explanation of where a Direct or CIPP Entra connection fails and what to fix. Provide two explicit run scopes: connection diagnostics (Alga readiness, partner authentication, discovery, and sync history) and selected-client access diagnostics. Reuse the Microsoft 365 email diagnostics engine and preserve its existing behavior and tests.

## Problem and user value

A single Validate result cannot distinguish profile configuration, partner consent, Lighthouse/GDAP discovery, customer-tenant permissions, and downstream sync failures. OAuth errors are coarse; useful sync errors are buried in Temporal activity text. Operators need named checks, dependency-aware skips, precise remediation, and a copyable support report without changing connection state while investigating it.

## Goals and non-goals

Goals:

- Identify the failing layer and give a concrete remedy with the right tenant context.
- Keep connection checks fast without customer-tenant fan-out.
- Let operators check selected mapped clients with incremental results and at most three clients in flight.
- Explain successful syncs that yield no contacts using the existing user exclusion rules.
- Reuse generic diagnostics primitives across email and Entra while preserving the email report contract.
- Supply redacted support evidence with Graph correlation identifiers.

Non-goals and settled decisions:

- No schedules, autonomous/background diagnostics, alerts, or notifications. Reading the existing sync schedule is in scope; changing it is not.
- No Graph `/applications` query, `Application.Read.All`, automatic redirect-URI verification, or signInAudience verification. Show expected values for manual comparison.
- No writes to connection validation, mappings, discovery cache, settings, sync runs, contacts, reconciliation queue, or Temporal schedules/workflows. Refreshing OAuth tokens may persist the refreshed token material exactly as the sync token path does; that is the sole persistence exception.
- No sync-engine behavior change, entitlement repair, consent mutation, or automatic remediation.
- No new diagnostic history table, feature flag, or monitoring subsystem.

## Users and primary flows

The target operator is an internal MSP user on EE with both `INTEGRATIONS` and `ENTRA_SYNC` tier access and `system_settings:read`. Update permission is not required. Client-portal users remain forbidden.

1. In Settings > Integrations > Entra > Connection, the operator clicks **Run diagnostics** beside Validate. The dialog runs connection checks and displays the overall result, summary, ordered steps, and recommendations. The unhealthy Overview attention list opens the same dialog.
2. Within the dialog, the operator selects mapped clients (initially all confirmed mappings), optionally enables **User yield preview** (initially off), and starts client access diagnostics. More than 20 selected clients requires confirmation. Names and progress appear as results complete; a failure for one client does not block another.
3. The operator expands a failed step, copies an expected value or customer consent URL, or navigates to the relevant settings screen. Opening a consent URL is an operator action, never an automatic consent operation.
4. The operator copies the support bundle or downloads JSON. Connection and client reports retain their own timestamps; combined views cross-reference the latest sync tenant failures with the selected-client results.

## Shared engine and report contract

Extract generic primitives into a neutral shared diagnostics module (proposed `shared/services/diagnostics/`) and canonical generic interfaces in `packages/types`. Preserve the existing Microsoft 365 imports through compatibility re-exports, including the `shared/interfaces` mirror. Avoid a dependency from shared code into EE or the integrations UI.

Shared primitives: `DiagnosticsStepStatus`, HTTP/error metadata, generic step/report envelope types, a timed `runStep(id,title,fn)` runner, overall-status fold, Graph failure classification, request-id/client-request-id capture, and safe token fingerprints. Inject domain-specific recommendation mapping and dependency policy: the email report keeps its string recommendations and existing execution behavior; Entra adds structured recommendations and explicit blocked steps. Do not change email's optional live subscription test semantics as part of this work.

Entra report:

- `createdAt`, `scope` (`connection` or `clients`), and `summary` with `connectionType`, `connectionStatus`, `profileName`, `partnerTenantId`, `authenticatedUpn`, `tokenExpiresAt`, `managedTenantCount`, `mappedClientCount`, `overallStatus`. Unavailable values are absent/null, never invented.
- `steps[]` with stable `id`, `title`, `status`, `startedAt`, `durationMs`, optional data, HTTP metadata, error metadata, recommendations, and a blocked reason where applicable.
- HTTP metadata: method, status, endpoint/path, Graph request-id and client-request-id; redact identifier-bearing paths unless `includeIdentifiers` is enabled.
- Error metadata: safe message, HTTP/Graph/OAuth code, `aadstsCode`, `suberror`, request identifiers; no raw Axios request config or authorization headers.
- `clients[]`: client id/name, Entra tenant id/display name, steps, overall status, primary remediation category and one-line remedy. Empty for connection-only runs.
- Structured `recommendations[]`: stable code, severity, text/localization key and parameters, optional action `{ kind: 'copy' | 'open_url' | 'navigate', payload: string }`. Deduplicate by code + affected context + action payload, retain distinct customer consent URLs, and order failures before warnings before informational advice.
- `supportBundle`: JSON-safe snapshot of report data without recursive nesting; all secrets/tokens become fingerprints, Graph request identifiers remain available. Copy and download use the same serializer.

A failure marks later **dependent** steps `skip` with `blocked by <step id>`. Independent checks still run. In particular, worker failure does not suppress Graph checks, missing binding does not suppress informational expected values, and token failure does not suppress local sync history. Overall status preserves the shared email fold (fail > warn > pass); skipped steps do not create failures. Client progress is not presented as a completed green report before all selected clients finish.

The step IDs below are the identifier after the numbered layer (for example `token_refresh` and `cipp_auth`); the numeric labels are presentation order. Keep these IDs stable in tests, report JSON, and localization keys. Client step IDs repeat only within separate client sub-reports.

## Connection diagnostics: layer 1

| Order / step ID | Behavior and acceptance |
| --- | --- |
| 1.1 `edition_tier_rbac` | Report edition, INTEGRATIONS, ENTRA_SYNC, and system_settings read sub-checks. Preserve authentication/authorization boundaries. A denied tier returns a safe readiness failure with “Entra requires the Pro tier” instead of a bare 403. Do not read integration records or secrets after denial. |
| 1.2 `connection_row` | Read the active connection record and display type, status, connected_at, last_validated_at, and safe last_validation_error message/code/checkedAt snapshot. Stored unhealthy status is evidence, not a reason to suppress fresh checks. Missing active connection fails with “Connect Microsoft Entra from Settings > Integrations > Entra”. |
| 1.3 `app_registration_binding` | Direct only: distinguish missing binding, missing profile, archived profile, and missing entra capability, reporting each condition and the available profile display name. Remedies respectively select an app, select an existing app, choose another app when the bound profile is archived, or edit the capability in Settings > Integrations > Microsoft. |
| 1.4 `client_secret_present` | Resolve bound profile client_secret_ref through the tenant secret provider, require a non-empty value, and show only the last four characters. If expiry is stored, show it and warn within 30 days; an expired secret fails. Current profile shape exposes no expiry, so show “expiry unknown, Microsoft client secrets expire in 6-24 months”; do not add an expiry migration for this card. |
| 1.5 `expected_app_registration_values` | Informational/pass. Show the exact server-derived callback URI, delegated User.Read, ManagedTenants.Read.All, Directory.Read.All, offline_access scopes, multi-tenant requirement (`AzureADMultipleOrgs`), and bound client id when available. Offer copy actions. Clearly label as manual comparison, not verified Azure configuration. On CIPP, label Direct-only expectations as not applicable informational content; do not require a Microsoft profile. |
| 1.6 `sync_worker_and_schedule` | Read Temporal namespace/task-queue availability and worker poller evidence, then describe the existing tenant sync schedule and compare to sync_enabled/interval. Report next fire time when available. Fail on unreachable worker/namespace; warn on missing/mismatched enabled schedule and warn when sync is off. The existing implementation deletes schedules when disabled, so absent schedule + disabled setting is consistent, with the sync-off warning. Never reconcile/create/delete/start anything. Distinguish successful Temporal frontend connectivity from evidence of an available worker. |

Guard design: extend/share the existing guard's evaluation so the diagnostics route/action can serialize safe sub-check results without duplicating access policy. Unauthenticated requests remain 401; forbidden users and tiers remain 403 with only safe readiness evidence. The action bridge must preserve that structured payload rather than collapse it into “Permission denied.” CE uses the existing unavailable/stub surface with a clear edition explanation and never loads EE services. The UI can explain denial even if the main Entra tab is gated.

The connect action currently assembles its own base URL, while setup metadata uses `getDeploymentBaseUrl` and visible Microsoft integration metadata. Unify the Entra callback computation behind a server helper consumed by connect, setup status, and diagnostics, preserving intended environment/secret precedence. Do not recreate it in the client or call a setup helper that seeds/backfills configuration during a diagnostic read.

## Direct connection: layers 2 and 3

| Order / step ID | Behavior and acceptance |
| --- | --- |
| 2.1 `token_set_present` | Report access-token and refresh-token fingerprints plus expiresAt presence. Missing refresh token fails with Reconnect Microsoft Entra. Missing/expired access token or absent expiry can warn and proceed to refresh if credentials and refresh token are usable. |
| 2.2 `token_refresh` | Force a refresh through the common authority using resolved credentials. Permit only existing refreshed-token persistence. Preserve Microsoft's error, suberror and AADSTS code and apply the remedy table below. |
| 2.3 `token_claims` | Decode without verifying signature, explicitly treating claims as diagnostic data. Report tid, upn/preferred_username, appid, aud, expiry. Warn separately for missing ManagedTenants.Read.All and Directory.Read.All; grant admin consent then reconnect. Fail when appid differs from the bound profile client id and skip dependent Graph discovery. Unreadable/opaque claims produce a clear warning, not a fabricated app mismatch. |
| 2.4 `graph_me` | GET `/me?$select=id,userPrincipalName` with the refreshed partner token. Capture HTTP/correlation metadata using the shared Graph classification. |
| 3.1 `managed_tenants_endpoint` | Call `entraDirectProbeEndpoint()` (beta managedTenants `$top=1`, or `/organization` in self-tenant smoke mode). 403 uses the probe's consent_missing remedy; 401 means token rejected after refresh; 400 says “Graph rejected the managedTenants request; this is an Alga-side endpoint fault, contact support”, retaining request-id. |
| 3.2 `managed_tenants_count` | Reuse full paged `listManagedTenants` behavior; report count and at most ten display names. Zero warns that the partner must be onboarded to Microsoft 365 Lighthouse with active GDAP relationships, and an un-onboarded partner can return no tenants regardless of app configuration. Respect the same smoke/emulator endpoint resolution throughout. |
| 3.3 `mappings_vs_discovery` | Compare confirmed tenant-scoped mappings with the live list. Warn for each missing mapped tenant, naming the client and explaining that GDAP may have expired or been terminated. Include tenant id in expanded detail/bundle. Report the count of discovered but unmapped tenants. Do not persist discovery or mapping changes. |

One successful refresh supplies the partner checks. Reuse adapter paging/normalization without implicit second refreshes or hidden writes. Carry request IDs through adapter error sanitization. Preserve existing public adapter behavior for sync callers.

## OAuth and Graph remedies

Match specific AADSTS/suberror before generic OAuth errors (for example invalid_grant with AADSTS65001 is a consent problem). Share the parser between live token failures and stored run error text. Preserve codes verbatim, sanitizing any unrelated sensitive values in descriptions.

| Failure | Partner remedy | Customer-tenant remedy/category |
| --- | --- | --- |
| AADSTS7000222 / invalid_client | Client secret expired or wrong; rotate in Azure and update the app registration in Alga. | Same app credential remedy; other. |
| AADSTS700016 | App not found or single-tenant; verify bound client id and multi-tenant app configuration. | App is single-tenant or has no service principal in this tenant; other. |
| AADSTS65001 / consent_required | Grant partner-tenant admin consent, then reconnect. | App is not consented here; reconnecting the partner will not help. Grant consent in this customer tenant; need consent. |
| AADSTS50076 / AADSTS50079 | Conditional Access requires MFA for the connecting account. | This tenant requires MFA/compliant device for the syncing account; conditional access. |
| AADSTS70000 / generic invalid_grant | Refresh token revoked or expired; reconnect. | Reconnect the expired/revoked grant unless a more specific code is present; other. |
| AADSTS90002 | Tenant not found; verify tenant configuration. | Tenant not found; verify mapping; other. |
| AADSTS50020 | Connecting account is not allowed in the tenant. | Account is not a guest/allowed here; verify account access; other. |
| Network failure | Endpoint unreachable; include DNS/TLS/timeout distinction where available. | Same reachability explanation; other. |
| Customer `/users` or `/groups` 403 | Not applicable. | Consent exists but the delegated account lacks a directory-read role via GDAP (for example Directory Readers). Check GDAP role assignments; missing role. |

Generate customer consent links server-side using the **bound application's client id**, not the mapped Alga client id: `https://login.microsoftonline.com/<entraTenantId>/adminconsent?client_id=<applicationClientId>`. Encode/validate values and provide copy and open actions. Never attach tokens, secret values, or arbitrary redirect URLs.

## Client access diagnostics: layer 4

Resolve selected confirmed mappings inside the authenticated tenant. Omitted clientIds means all confirmed mappings; an explicit empty selection means none and must not silently fan out. Reject unmapped/foreign selections before external calls. Execute steps in order within each client, with at most three clients in flight across the dialog run. A client failure affects that client's dependent steps only.

| Order / step ID | Behavior and acceptance |
| --- | --- |
| 4.1 `tenant_token_mint` | Mint one managed-tenant token using refreshEntraDirectAccessTokenForTenant; reuse it for that client's reads. Never overwrite the partner access token with it. Existing rotated refresh-token persistence remains permitted. Apply customer-specific OAuth remedies and consent links. |
| 4.2 `users_read` | GET `/users?$select=id&$top=1`; keep the first returned user id internally for membership testing, and capture request-id on failures. An empty directory is not an access failure. |
| 4.3 `groups_read` | GET `/groups?$select=id&$top=1`; classify directory-role denial independently of the users result when the minted token is usable. |
| 4.4 `entitlement_group_resolves` | If configured, GET `/groups/<id>?$select=id,displayName,securityEnabled`. A 404 fails with “the configured entitlement group no longer exists”; report securityEnabled and flag a non-security group. Then perform a read-only `checkMemberGroups` POST for the first user from users_read. No configured group means skip; no user means skip just membership sub-check, retaining group resolution evidence. |
| 4.5 `user_yield_preview` | Off by default. With opt-in, reuse full listUsersForTenant paging and existing filter rules/settings; report total/included users and excluded counts by account_disabled, missing_identity, service_account, tenant_custom_pattern. Warn when a non-empty directory is 100% excluded. Show an empty directory separately. No user/contact writes or preflight run-history records. |

The ordinary run makes two one-item Graph reads per client, plus the group lookup/membership calls only when entitlement configuration requires them. The optional full-directory yield preview is explicitly labeled as more expensive. Extend adapter seams only as needed to reuse the minted token and paging/normalization; do not mint a second token for preview or membership.

Client table uses client name and tenant display name, status, one-line remedy, and expandable details. Never use a GUID as the visible name fallback; use a localized unavailable-name label. GUIDs may appear in expanded detail. Aggregate each completed client once into `ok`, `need consent`, `conditional access`, `missing role`, or `other`. A warning needing attention (including all users excluded) belongs to other rather than ok; deterministic primary-failure precedence prevents double counting.

## CIPP connection and client checks

CIPP shares applicable layer 1 and layer 5 checks and replaces Direct layers 2–4. Do not require Direct OAuth secrets for CIPP.

| Order / step ID | Behavior and acceptance |
| --- | --- |
| C.1 `cipp_credentials_present` | Require configured base URL and API token; display sanitized URL and token fingerprint only. |
| C.2 `cipp_reachable` | Probe tenant-list candidates in existing order: `/api/listtenants`, `/api/tenant/list`, `/api/tenants`. Report attempted and answering endpoint; distinguish DNS, TLS, timeout, and HTTP failures. A 401/403 proves HTTP reachability and is attributed to cipp_auth, avoiding duplicate red failures. |
| C.3 `cipp_auth` | 401/403 fails with “CIPP rejected the API credential. Rotate it from the Connection tab. Note this is the CIPP API key from Settings > CIPP > API access in CIPP itself, not an Azure client secret.” |
| C.4 `cipp_tenant_list` | Reuse successful list payload/normalization, report count and at most ten names. Zero warns to check CIPP customer visibility/configuration rather than Lighthouse onboarding. |
| C.5 `cipp_mappings_vs_list` | Compare confirmed mappings to CIPP live tenant list with client-specific warnings and unmapped-discovery count. |
| C.6 `per_tenant_users` | Client run: read one page through CIPP adapter for each selection, capturing access failures. Use `user_yield_preview` only on opt-in, then fetch the full directory to count exclusions. Make a bounded page-read seam if the existing listUsersForTenant exhausts all pages. |

Preserve existing CIPP probe callers while adding safe structured evidence; do not lose endpoint/status/network cause through today's coarse probe result.

## Sync pipeline health: layer 5

These are independent local reads, even when partner authentication/discovery fails.

| Order / step ID | Behavior and acceptance |
| --- | --- |
| 5.1 `last_runs` | Show last five runs: status, trigger, duration, created/linked/updated/ambiguous/inactivated totals. Decode the latest failed run's error, including nested Temporal error text and AADSTS remedies. Warn for two consecutive unsuccessful syncs using the notification rule's failed/partial semantics; dry runs do not establish connection health or interrupt the real-sync failure sequence. No history is an informational no-runs state. |
| 5.2 `per_tenant_last_result` | Read entra_sync_run_tenants for the latest actual sync run and name failed mapped clients with their safe errors. When client diagnostics are also available, link by mapped client/tenant and show timestamps; do not claim old failures are current after a newer pass. |
| 5.3 `reconciliation_queue` | Read open item count and oldest age. Warn when count > 0: “Review queue has N items waiting; ambiguous matches are never auto-linked.” Include navigation to review queue. |

## API, progress, and persistence boundaries

Add `runEntraConnectionDiagnostics()` and `runEntraClientAccessDiagnostics({ clientIds?: string[], includeUserYield?: boolean })` under integrations actions (a sibling entraDiagnosticsActions.ts is appropriate), following withAuth and requireEntraAccess('read'). Add matching EE routes, base-server CE delegators, packages/ee stubs, and integrations EE/OSS route entries. All DB queries and joins use the tenantDb facade and derive tenant/user from authentication, never from untrusted request input.

Connection diagnostics return one report. Client access must not put 50 tenants into one request or start an unobserved background task. The planned transport is a bounded, operator-driven continuation protocol:

- Start validates the selection and returns an opaque, authenticated, expiring job id/continuation plus total count.
- Poll/continue requests execute a bounded batch (at most three clients); return completed per-client sub-reports, counts, and next continuation. The dialog folds each response into the report as it arrives. The implementation may use smaller batches to stay within deployment request budgets.
- Bind continuations to caller/tenant, chosen mapping identities, scope/options, and expiry. Recheck access and current mapping/connection validity for every continuation. Sign/authenticate continuation state server-side; never embed credentials/tokens or trust client-submitted report results for authorization.
- Keep progress/results in the active dialog and authenticated continuation state, with no DB/secret-store job writes, no Temporal workflow, and no scheduled polling when the dialog is closed. No process-local background promise may be required for correctness across replicas. A lost/expired run can be explicitly restarted.
- Use request timeouts for external probes. Paginate/yield preview work with continuation if a full directory cannot fit a request; preserve completed clients and report unfinished/expired work honestly. Normal bounded checks use one token per client attempt, while resumed work may refresh on expiry; never serialize that token to the browser.

This job-id protocol is request-driven progress for an explicit operator run, not an autonomous diagnostics scheduler. Validate continuation tampering, identity changes, retries, and interrupted runs. If the chosen existing transport cannot meet these boundaries, revise the transport implementation within this contract before shipping; do not add persistent jobs as an implicit exception to zero writes.

Read-only rules apply through helpers too: do not call updateEntraConnectionValidation, discovery persistence, settings upserts, applyEntraSyncSchedule, or runEntraPreflight. The current preflight persists entra_sync_runs even in dry-run mode. Reuse filterEntraUsers/filterEntraUsersForTenant and pure counting instead. Treat read-only Graph POST checkMemberGroups and OAuth refresh as explicit endpoint exceptions to a simple GET-only allowlist.

## Redaction and UI

Use the standard Dialog, Badge, DataTable, Button, existing selection controls, and ConfirmationDialog. Follow repository dialog footer, unique interactive-id, accessibility, theme, and loading-state conventions. All user-facing strings live under `msp/admin`, `integrations.entra.diagnostics.*`, including stable step-key titles, summaries, blocked reasons, confirmations, and remedies.

The dialog contains overall badge, summary grid, ordered expandable step list with HTTP/error details, severity-ordered action recommendations, client selection/yield toggle/progress/table/aggregate, and Copy support bundle / Download JSON in the footer. Prevent duplicate starts; show partial and terminal error states; stop issuing continuations after close. Preserve completed results during transient polling errors and let the operator explicitly retry/restart.

Default exports redact tenant/client/user/application identifiers in endpoint URLs and diagnostic data where appropriate, including action URLs and nested error text. The authenticated UI can display names, expected app client id, useful consent URLs, and tenant GUIDs in expanded detail. An explicit includeIdentifiers export control may retain identifiers for support, but **never** full tokens or secrets. Both variants retain Graph request IDs. Server-side serialization performs secret redaction before data crosses the boundary; client copy/download must not be the only sanitizer. Do not expose raw user-directory rows during yield preview.

## Documentation and validation

Extend `ee/docs/guides/entra-integration-phase-1.md` with a Diagnostics section explaining scopes, layers, read-only semantics, sync-off warning, client table, optional yield, and support export. Merge the existing AADSTS remedy table with these remedies so there is one authoritative table; preserve the existing documentation contract tests.

Add a user-facing nm-store website page explaining where to click, how to read the client table, and how to act on partner versus customer consent failures, with screenshots. Use the alga-business-documentation skill during that implementation task and locate its repository using that skill; this plan does not invent a website path or claim publication. Capture the green console run plus at least two failure runs against the emulator with no real customer data.

The tests checklist deliberately uses representative suites for approximately 80% confidence rather than one test per line item. Mandatory gates:

- Existing MicrosoftGraphAdapter.diagnostics.test.ts passes unchanged after extraction.
- Shared runner/fold, AADSTS table, action URL/dedupe/redaction, and dependency skips have unit coverage.
- Real migrated-DB integration happy path plus guard/tenant-isolation failure case; prove diagnostic calls leave all domain tables unchanged, including missing-settings paths.
- Emulator green connection, partner consent_missing, customer AADSTS65001, customer users 403, zero tenants, expired client secret; add missing fault fixtures.
- Representative CIPP endpoint fallback/network/auth/list/client tests.
- Component report rendering, names instead of GUIDs, redacted copy/download, selection/confirmation/progress.
- Console smoke for both scopes, green evidence and at least two distinct failure screenshots.
- Guide contract test and website documentation validation.

## Delivery sequence and acceptance criteria

1. Extract shared diagnostics types/runner/classifier and switch email consumers; pass unchanged email regression gate before adding Entra behavior.
2. Add safe readiness/credential inspection, OAuth classification, read-only adapters, and connection checks for Direct/CIPP plus sync health.
3. Add selected-client checks, pure yield counts, bounded continuation actions/routes, and EE/CE boundary coverage.
4. Build/localize dialog and both entry points; integrate progress, remediation actions, and safe exports.
5. Add emulator/DB/component coverage, run console smoke, capture evidence, and complete both documentation surfaces.

Done means all stable checks above produce the specified outcomes, blocked dependencies skip meaningfully, no unauthorized reads or prohibited writes occur, CIPP and Direct both work, selected clients produce incremental bounded results, email behavior remains unchanged, and the verification/documentation evidence is recorded. Checklists remain false until their implementation/test work actually lands. Creating this plan does not mark product features complete.

## Risks, rollout, and remaining implementation checks

- No schema migration is expected. No new tier/flag or notification behavior is needed; diagnostics inherit existing Entra availability. Keep CE imports build-safe.
- Temporal frontend reachability does not prove a worker is polling. Use read-only namespace/task-queue descriptions; label unavailable poller evidence explicitly instead of claiming worker execution succeeded. Never start a workflow as a probe.
- Existing token refresh wraps errors into operator messages and managed-tenant refresh can rotate the common refresh token. Preserve safe structured metadata and reuse existing rotation semantics without replacing the partner access token. Exercise concurrency and rotation in tests.
- Continuation transport must respect strict zero DB writes and a request budget, including optional full-directory yield. Validate the bounded implementation with a multi-client fixture, not only a single-client happy path.
- No stored client-secret expiry was found in the current profile interface. Show unknown expiry; do not infer an expiration date.
- The commissioning brief references alga-emulator-testing, which is not in the available skill catalog or searched skill roots. The emulator source/README and existing tests are available; locate that skill if installed elsewhere during implementation, or follow the repository harness. This does not block writing the plan.
- The nm-store checkout and website build/screenshot destinations must be located during the documentation task. No public publishing or board advancement is performed by this planning assignment.
- Product scope has no unanswered decisions: the commissioning brief supplies the agreed requirements. These are implementation checks, not requests to reopen the settled decisions.
