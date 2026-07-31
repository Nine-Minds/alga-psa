# SCIM User Lifecycle Scratchpad

## Status

- Planning started 2026-07-23.
- PRD scope is not yet approved.

## Confirmed Existing Behavior

- Alga supports Microsoft and Google SSO for MSP users.
- Alga rejects SSO authentication when the matched Alga user has `is_inactive=true`.
- Alga administrators can manually activate and deactivate users.
- The Entra integration currently processes directory users for client-contact synchronization; it is not an internal Alga-user lifecycle service.
- No SCIM routes or SCIM protocol implementation were found in the current codebase.
- Disabling a user in Entra blocks future Microsoft authentication, but does not mark the Alga user inactive or necessarily terminate an existing Alga session.

## Candidate Direction

- Add a tenant-scoped SCIM 2.0 service provider for Entra automatic provisioning.
- Match provisioned identities using an immutable external identity identifier rather than email alone.
- Treat SCIM `active=false` as reversible Alga user deactivation, preserving historical PSA records.

## Open Decisions

- Whether the first release should manage existing Alga users only or also create users.
- Whether the first release supports Entra only or targets interoperable SCIM 2.0 clients.
- Which Alga user types are in scope.
- How roles, teams, licenses, and SSO provider assignments behave during provisioning.
- Required session-revocation behavior and acceptable propagation delay.

## Existing CIPP / Entra Sync Assessment

### Current Purpose and Flow

- The existing Entra integration is an MSP directory-to-client-contact synchronization feature.
- It connects per Alga tenant using either:
  - `cipp`: CIPP base URL plus API token.
  - `direct`: Microsoft OAuth/Graph credentials with token refresh.
- Both providers implement the same adapter concept: discover managed Entra tenants, then list normalized users for a selected managed tenant.
- Managed Entra tenants are mapped to Alga `clients`; directory users are then matched, created, linked, updated, or inactivated as Alga `contacts`.
- Direct Graph synchronization uses `tenantRelationships/managedTenants/*`, confirming that the production path is designed around CSP/GDAP-managed customer tenants rather than the MSP's own workforce tenant.
- The self-tenant direct path is explicitly smoke-test-only and guarded against production use.
- Synchronization runs are orchestrated asynchronously through Temporal and persisted in tenant-scoped run/run-tenant tables.

### Useful Existing Building Blocks

1. **Normalized Entra identity shape**
   - `EntraSyncUser` already carries Entra tenant ID, immutable object ID, UPN, email, display name, names, `accountEnabled`, title, and phones.
   - CIPP and direct Graph adapters normalize provider-specific responses into this shape.
   - The immutable identity pair `(entraTenantId, entraObjectId)` is already established as the safe correlation key.

2. **Provider normalization and polling, if needed**
   - Both adapters already retrieve `accountEnabled` and normalize inconsistent CIPP boolean representations.
   - These adapters could support a reconciliation/backfill or diagnostic job for Entra-backed tenants.
   - They should not be the primary SCIM ingestion path because SCIM is an inbound push protocol and does not require CIPP or Graph credentials.

3. **Tenant-safe persistence patterns**
   - Existing repositories consistently scope rows by Alga tenant and use tenant-aware database helpers.
   - Composite keys and distributed-table patterns provide a model for new SCIM configuration, external-identity, operation-log, and reconciliation tables.

4. **Connection/status UX patterns**
   - The Entra settings UI already has connection status, validation, last validation error, last discovery/sync status, feature gating, and explicit disconnect behavior.
   - SCIM setup can reuse these interaction patterns, but should appear as a distinct "User provisioning" capability rather than another CIPP/direct connection type.

5. **Run history and operational patterns**
   - Existing sync-run summaries, per-scope counters, workflow IDs, and status drill-down provide patterns for SCIM operation history and any periodic reconciliation job.
   - Real-time SCIM requests themselves should be handled synchronously and idempotently; they should not be routed through the existing contact-sync Temporal workflow.

6. **Ambiguous-match handling concept**
   - The current reconciliation queue demonstrates a safe manual-resolution workflow when email matching is ambiguous.
   - A user-provisioning equivalent may be useful for initial linking of existing Alga users, but it requires a separate queue and user-specific rules. The contact queue cannot be reused directly.

7. **Reversible disable semantics**
   - The existing contact disable handler already distinguishes `disabled_upstream` from `deleted_upstream` and preserves records rather than purging them.
   - This is a useful semantic precedent for setting Alga users inactive while preserving PSA history.

### Contact-Specific Components That Should Not Be Reused Directly

- `entra_client_tenant_mappings`: maps managed Entra tenants to Alga clients, not an Alga tenant to its workforce directory.
- `entra_contact_links`: foreign keys to contacts and assumes contact ownership/lifecycle.
- Contact email matcher and ambiguous-contact reconciliation queue.
- Contact creation and field-sync patch logic.
- Contact disable handler and contact-specific sync status columns.
- Existing sync counters (`created`, `linked`, `updated`, `ambiguous`, `inactivated`) may inspire SCIM metrics but describe batch contact processing.
- Existing initial/all-tenants/single-client Temporal workflows and API scopes.

### Recommended Reuse Boundary

- Reuse concepts and shared low-level helpers, not the contact-sync domain service.
- Extract or generalize only narrowly useful primitives when implementation begins:
  - normalized external directory identity;
  - tenant-scoped external identity correlation;
  - safe boolean/string normalization if a polling reconciliation adapter is added;
  - secret generation/storage patterns;
  - connection-health and operation-history presentation patterns.
- Build SCIM as a separate tenant-scoped inbound provisioning module with its own routes, bearer credentials, configuration, identity links, idempotency/audit records, user reconciliation rules, and session-revocation behavior.
- Do not require CIPP or Microsoft Graph authorization for baseline SCIM. Entra's provisioning service is the client and calls Alga.
- Optionally add a later Graph/CIPP reconciliation tool using the existing adapters, but keep it outside the critical deprovisioning path.

### Rough Piggyback Estimate

- **High conceptual reuse:** identity keys, normalized user fields, tenant isolation, reversible disable semantics, setup/status/run-history UX.
- **Moderate code reuse:** secret handling, database helper patterns, provider-neutral types after careful extraction, status serialization components.
- **Low direct domain reuse:** contact matching, contact links, contact reconciliation queue, contact mutation, existing Temporal workflows.
- Overall, this materially reduces discovery and infrastructure design work, but likely only about **20-30% of the SCIM implementation code** should come directly from the existing Entra integration. Attempting more reuse would create the wrong abstraction.

## Decision: Existing Users Only

- The first SCIM release will not create Alga users.
- An Alga administrator must create the internal user and assign licenses, roles, teams, and permissions through existing Alga workflows.
- SCIM may link an Entra identity to an existing Alga user, update approved identity/profile fields, deactivate the linked user, and reactivate the linked user.
- Requests for unlinked Entra identities must not create a user implicitly.

## Decision: Exact Email Auto-Linking

- Automatic SCIM linking requires exact, case-insensitive normalized equality between the SCIM primary email and one existing, unlinked Alga internal user's email in the same tenant.
- The initial release will not use fuzzy matching, aliases, display names, inferred domains, or UPN fallback when the primary SCIM email differs.
- Zero matches or multiple matches fail safely and are surfaced for administrator reconciliation.
- The Munjal `techff.com` / `joymode.io` mismatch would remain unresolved automatically by design; avoiding an incorrect identity link is more important than silently accommodating aliases.
- After an administrator explicitly resolves a mismatch, the immutable SCIM external identity becomes the correlation key for subsequent lifecycle operations.

## Decision: No Automatic Email Mutation

- SCIM will not automatically update an Alga user's email after linking.
- Subsequent email differences are recorded and displayed as identity drift for administrator review.
- The immutable SCIM external identity, not the current email, remains the correlation key after linking.
- Administrators must change an Alga user's login/notification email through the existing Alga user-management workflow.

## Decision: Source-Aware Reactivation

- SCIM `active=false` marks the linked Alga user inactive and records SCIM as the deactivation source.
- SCIM `active=true` may reactivate the user only when SCIM is the current deactivation source.
- SCIM must not override a manual administrator deactivation, suspension, or another policy source.
- The existing `users.is_inactive` value remains the effective status; additional lifecycle provenance records the source, upstream state, timestamps, and relevant provisioning operation.

## Decision: Immediate Session Revocation

- A successful SCIM deactivation must immediately invalidate all active Alga sessions for the linked user.
- The user must lose access without waiting for session expiry, another SSO attempt, or a token refresh.
- The deactivation result must not be reported as successful unless the effective inactive state is persisted and session invalidation has been completed or durably guaranteed.

## Decision: SCIM DELETE Is Reversible Deactivation

- SCIM `DELETE /Users/{id}` never deletes an Alga user or historical PSA data.
- DELETE applies the same effective access revocation as `active=false`, including immediate session invalidation.
- The SCIM identity link is retained in a deprovisioned/tombstoned state.
- A later reassignment or reprovisioning request can resolve to the same Alga user and reactivate it when SCIM remains the applicable lifecycle source.

## Decision: Standards-Based Surface, Entra-Supported Release

- Expose a standards-based SCIM 2.0 service-provider surface without Entra-specific request contracts.
- Microsoft Entra automatic provisioning is the only officially supported and comprehensively tested client in the first release.
- Setup documentation, interoperability accommodations, and end-to-end acceptance testing target Entra.
- Compatibility with other SCIM clients is not promised until separately tested and documented.

## Decision: Lifecycle-Only Attribute Authority

- SCIM manages identity linking and lifecycle state only in the first release.
- Incoming display name, given name, surname, title, UPN, and email are stored as observed directory metadata and may be shown as drift.
- SCIM does not mutate the Alga user profile, roles, teams, permissions, licenses, or notification settings.
- Existing Alga administration remains authoritative for all non-lifecycle user fields.

## Decision: Tenant Self-Service SCIM Configuration

- Authorized tenant administrators configure SCIM from Alga Security settings.
- Access is restricted by the existing security-administration permission model.
- SCIM configuration is independent from SSO configuration and can be revoked without disconnecting SSO.
- Alga generates bearer credentials; plaintext is displayed once and only a secure hash is persisted.
- Token rotation supports a short, explicit overlap window so Entra can be updated without provisioning downtime.
- Administrators can revoke current or overlapping credentials and view connection/operation health without revealing token material.

## Decision: Upstream Inactive State Blocks Manual Reactivation

- An Alga administrator cannot directly reactivate a user while the linked SCIM identity remains authoritatively inactive or deprovisioned.
- The UI must explain that access is managed by SCIM and direct the administrator to restore the user upstream.
- An administrator may explicitly unlink the SCIM identity, after which existing Alga lifecycle controls apply.
- Unlinking is a deliberate security-sensitive action and must not implicitly reactivate the user.

## Decision: Disabling SCIM Preserves Current State

- Disabling the tenant SCIM integration stops future provisioning requests and lifecycle changes.
- Existing identity links remain stored.
- Active users remain active and inactive users remain inactive.
- Disabling SCIM does not mass-reactivate, mass-deactivate, or mass-unlink users.
- Administrators review and change individual user lifecycle state or identity links explicitly after disabling the integration.

## Decision: Users Resource Only

- The first release supports SCIM `/Users` lifecycle operations only.
- SCIM Groups are not supported and the service-provider metadata must advertise that limitation accurately.
- Entra group assignment may still determine which users are in provisioning scope upstream, but Alga will not receive or map group objects.
- Mapping groups to Alga roles, teams, or permissions is a separate future authorization design.

## Decision: Internal MSP Users Only

- The first release manages existing internal MSP users only.
- Client-portal users, contacts, external users, service accounts, and MCP agent identities are out of scope.
- SCIM discovery and exact-email matching must exclude every unsupported user type.
- Client-portal identity lifecycle remains a separate future design because ownership and authorization semantics differ.

## Decision: Dedicated Inbound SCIM Module

- The first release uses a dedicated tenant-scoped inbound SCIM 2.0 module.
- Entra's provisioning service calls Alga directly using the tenant's SCIM endpoint and bearer credential.
- The existing CIPP/direct Graph contact-sync engine is not placed in the critical user-lifecycle path.
- Periodic Graph/CIPP lifecycle reconciliation is deferred unless production evidence later justifies the additional credentials and complexity.

## Approved Design: Architecture and Trust Boundary

- Tenant-specific SCIM base URL uses an opaque connection ID and bearer authentication.
- Support SCIM discovery metadata and the complete Users CRUD/PATCH surface required by Entra; do not expose Groups.
- Introduce separate SCIM connection, user-link, and sanitized operation-history persistence.
- Authenticate before entering tenant context; tenant-scope every subsequent operation.
- Lifecycle mutations are synchronous and idempotent, with durable session revocation required for successful deactivation.

## Approved Design: Identity Linking and Lifecycle Flow

- SCIM POST creates a link to an existing internal Alga user; it never creates an Alga user.
- Automatic linking requires exactly one eligible active, unlinked user with an exact normalized primary-email match.
- Rejected identities are surfaced for administrator reconciliation; manual linking is an explicit audited override.
- After linking, stable SCIM resource/external identity keys replace email as the correlation mechanism.
- SCIM lifecycle operations update observed upstream state, apply source-aware reversible inactivity, and revoke sessions immediately.
- DELETE tombstones the link and preserves the Alga user; retries are idempotent and duplicate links are prevented by database constraints.

## Approved Design: Administrator Experience

- Add Settings > Security > User provisioning adjacent to, but independent from, SSO.
- Provide self-service URL/token setup, Entra mapping guidance, connection testing guidance, health, rotation, revocation, and disable controls.
- Show linked users, observed directory metadata, upstream/effective state, lifecycle source, drift, and operation timestamps.
- Provide an unresolved-identity review queue with explicit manual-link confirmation.
- Mark linked users as SCIM-managed in ordinary User Management and block reactivation while upstream state remains inactive.
- Unlinking is explicit, retains history, and never changes effective active state automatically.

## Approved Design: Protocol and Failure Handling

- Support the SCIM Users operations, filters, discovery metadata, media types, and PATCH behavior required by Entra.
- Advertise Bulk, password sync, sorting, Groups, and role provisioning as unsupported.
- Use standard sanitized SCIM error bodies and fail closed without cross-tenant or identity leakage.
- Make external identity linking and lifecycle operations idempotent under retries and concurrency.
- Persist inactive state, provenance, link state, durable session revocation, and sanitized operation history atomically.
- Apply timing-safe token verification, rate limiting, payload redaction, and security audit events.

## Decision: EE and Pro-Tier Entitlement

- SCIM implementation lives in the EE portion of the codebase with CE-safe stubs or route registration behavior consistent with other EE capabilities.
- SCIM requires the Pro tier or higher.
- Entitlement checks protect both the Security-settings UI/actions and every SCIM runtime endpoint.
- Loss of entitlement disables new provisioning operations but preserves connections, identity links, operation history, and effective user states.
- Restoring entitlement resumes the existing configuration without silently rotating credentials or changing user states.

## Approved Design: EE Placement, Entitlement, and Session Enforcement

- Place functional SCIM routes, domain services, UI, and migrations in EE; CE exposes no functioning provider.
- Require a new Pro-or-higher SCIM provisioning entitlement at both UI/action and runtime endpoint boundaries.
- Track SCIM-applied inactivity on the identity link so active=true reverses only SCIM's own state.
- Reuse tracked session infrastructure by adding all-sessions-for-user revocation with a SCIM reason.
- Tighten protected-request enforcement so revoked sessions are rejected on the next request across all pods, without waiting for the current throttled JWT check.
- Existing tenants receive no automatic connection, links, or lifecycle changes; setup is explicit and independent from SSO.

## Approved Design: Test Strategy

- Cover protocol parsing/serialization, credentials, and sanitization with focused unit tests.
- Require real migrated-database integration coverage for linking, tenant isolation, lifecycle provenance, session revocation, DELETE preservation, retries, entitlement loss, and attribute drift.
- Exercise an Entra-style API sequence end to end, including immediate rejection of a previously valid session after deactivation.
- Cover setup, token lifecycle, reconciliation, managed-status, and disablement warnings in focused UI tests.
- Retain a live Entra enterprise-application acceptance smoke test for real interoperability.

## Added Requirement: SCIM Emulator

- Build a first-party SCIM provisioning-client emulator in the same role as Alga's other external-provider emulators.
- The emulator is the primary deterministic integration harness; live Entra testing remains a smaller compatibility smoke test.
- Keep the emulator self-contained and Docker-capable so it can run locally and in CI without Microsoft credentials.

## Approved Design: SCIM Emulator

- Build a self-contained TypeScript SCIM provisioning-client emulator, Docker-capable for local and CI use.
- Support deterministic directory identities, assignment, enable/disable, unassignment/deletion, reassignment, drift, token rotation, retries, concurrency, and request history.
- Include failure injection for authentication, schemas, filters, PATCH payloads, timeouts, retries, duplicates, and out-of-order operations.
- Use the emulator as the primary HTTP/DB-backed integration harness.
- Keep a smaller live-Entra acceptance smoke test for Entra-specific interoperability behavior.
- Keep emulator code out of production EE bundles and align its final location with the authoritative repository emulator convention during implementation.

## Design Approval

- All design sections approved on 2026-07-23.
- Formal artifacts created: `design.md`, `PRD.md`, `features.json`, and `tests.json`.
- Estimated implementation scope: 79 atomic features and 31 Pareto-focused tests.
