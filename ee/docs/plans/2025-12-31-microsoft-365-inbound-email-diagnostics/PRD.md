# PRD — Microsoft 365 Inbound Email Diagnostics

- Slug: `microsoft-365-inbound-email-diagnostics`
- Date: `2025-12-31`
- Status: Draft

## Summary

Add a Microsoft 365 (Entra ID + Exchange Online) diagnostics tool inside the Admin email setup UI to help customers self-diagnose OAuth, mailbox access, folder access, and webhook subscription creation issues. The diagnostics should produce an actionable, copy/pasteable “support bundle” with Graph correlation IDs and concrete remediation steps (scopes, mailbox permissions, folder selection).

## Problem

Inbound email for Microsoft 365 relies on:

1. User OAuth consent (delegated permissions)
2. Selecting a mailbox (user mailbox or shared mailbox)
3. Resolving a folder to monitor (typically Inbox)
4. Creating a Microsoft Graph webhook subscription to the folder’s messages

Customers frequently fail at steps 2–4 due to:

- Insufficient OAuth scopes or missing admin consent
- Lack of delegated access to a shared mailbox/folder
- Mailbox is not a mailbox (group/contact) or is not provisioned/initialized
- Folder selection/resolution mismatch (“Inbox not found”, non-English display names, custom folder, etc.)

Today we surface generic errors (e.g. Graph `404 ExtensionError` “Default folder Inbox not found”) without enough context for the customer to resolve the issue independently.

## Goals

- Provide an in-app, Microsoft-only diagnostics workflow that:
  - Runs deterministic Graph preflight checks.
  - Classifies failures (401/403/404/429/etc.) with targeted recommendations.
  - Shows the exact mailbox path decision (`/me` vs `/users/{mailbox}`) and why.
  - Helps resolve folder issues by enumerating folders and identifying the selected folder.
  - Produces a redacted “support bundle” including Graph `request-id` / `client-request-id`.
- Reduce support tickets and time-to-resolution for Microsoft inbound email setup.

## Non-goals

- Build a standalone CLI tool (diagnostics must be in-app first).
- Add Google/Gmail diagnostics (this plan is Microsoft-only).
- Replace or redesign the OAuth flow itself (only add observability + diagnostics around it).
- Persist or display raw access tokens/refresh tokens to end users.

## Users and Primary Flows

### Persona: Tenant Admin setting up inbound email

1. Admin opens Admin → Email Settings → Inbound Email Providers.
2. Admin selects a Microsoft provider and clicks “Run Microsoft 365 diagnostics”.
3. The app runs checks and renders results step-by-step:
   - Green/Yellow/Red status per check
   - Key facts (tenant id, authorized user, target mailbox, target folder)
   - Suggested fixes (missing scopes, mailbox permissions, choose different folder, provisioning hints)
4. Admin copies the “support bundle” and shares it with support if needed.

### Persona: Support engineer assisting customer

1. Customer provides the support bundle.
2. Support uses Graph request IDs + error classification to quickly identify likely root cause.

## UX / UI Notes

- Entry point: add a “Diagnostics” action for Microsoft providers in the existing admin email provider configuration UI.
- Output format:
  - A compact table/list of checks with status, duration, and expandable details.
  - A single “Copy support bundle” action (JSON and/or text) with redaction applied.
- Include warnings for actions that may create/renew subscriptions.
- Keep diagnostics results ephemeral (in-memory response) unless explicitly saved by an admin.

## Requirements

### Functional Requirements

Diagnostics should run a checklist of Microsoft Graph checks using the provider’s stored OAuth tokens and configuration, including:

- Token validity and expiry (preflight)
- Decoded token claims for customer visibility (scopes, tenant id, delegated vs app)
- Graph connectivity to `/me`
- Mailbox base path decision (`/me` vs `/users/{mailbox}`), and validation that the chosen mailbox exists/works
- Folder reachability:
  - Prefer Graph well-known folder endpoint (`.../mailFolders/inbox`)
  - Enumerate available folders if Inbox/folder resolution fails
  - Determine whether the configured folder is resolvable by id or display name
- Message read preflight for the exact target resource we intend to subscribe to
- Error classification with actionable suggestions
- Correlation identifiers:
  - Capture Graph `request-id` from response headers/errors
  - Set and capture `client-request-id` for each request

### Non-functional Requirements

- Safety:
  - Do not leak secrets (tokens, client secrets) in UI output or support bundle.
  - Diagnostics must be restricted to authorized admin users.
- Performance:
  - End-to-end diagnostics should complete in ~10–20 seconds in normal conditions.
  - Concurrency limits to prevent a tenant from triggering excessive Graph calls.
- Reliability:
  - Each step should fail independently and record its own error context.
- Compatibility:
  - Must support both personal mailbox (`/me`) and shared/delegated mailbox (`/users/{mailbox}`).

## Data / API / Integrations

### New server-side entrypoint

Add a server action (or admin API route) like:

- `runMicrosoft365Diagnostics(providerId: string, options?: DiagnosticsOptions): Promise<DiagnosticsReport>`

Where `DiagnosticsReport` includes:

- `summary` (overall status + key facts)
- `steps[]` (ordered checks; each with status, timing, sanitized request/response metadata)
- `recommendations[]` (deduplicated)
- `supportBundle` (redacted JSON payload)

### Adapter integration

Implement Microsoft-specific diagnostic helpers close to existing Graph logic:

- Add a diagnostics method to `shared/services/email/providers/MicrosoftGraphAdapter.ts` that:
  - Reuses the existing authenticated HTTP client (including token refresh).
  - Emits structured diagnostic step results.
  - Adds `client-request-id` on every Graph request for correlation.

## Security / Permissions

- Diagnostics UI only visible to tenant admins (same access level as provider setup).
- Redaction rules:
  - Access/refresh tokens: never shown; optionally show fingerprint (first 4 + length).
  - Client secrets: never shown.
  - Email addresses: show fully to the tenant admin (tenant-owned), but redact in the exported “support bundle” unless the admin explicitly opts in.
- Avoid storing diagnostics results in DB by default.

## Observability

- For each diagnostic step log structured events including:
  - provider id, tenant id, mailbox, folder, step id, duration, outcome
  - Graph `request-id` / `client-request-id`
  - Sanitized error code/status/message
- Ensure the UI can display the Graph `request-id` prominently when failures occur.

## Rollout / Migration

- Feature-gated behind “Microsoft 365 Diagnostics” flag (tenant-level or global) if available; otherwise ship as admin-only UI.
- No DB migrations required unless we later choose to persist diagnostics runs.

## Open Questions

1. Should the diagnostics include an optional “subscription create/delete” live test, or remain read-only (preflight GETs only)?
2. Should the exported support bundle include mailbox address by default, or redact unless “Include identifiers” is toggled?
3. What exact OAuth scopes do we currently request for Microsoft inbound email, and do we want diagnostics to assert a minimum set?
4. Do we support national cloud endpoints (GCC/DoD), or only `graph.microsoft.com` public cloud?

## Acceptance Criteria (Definition of Done)

- Admins can run Microsoft 365 diagnostics for a configured Microsoft inbound email provider from the UI.
- Diagnostics provide clear pass/fail results for mailbox + folder reachability and token/scope visibility.
- Known failure modes (401/403/404 Inbox not found/429) produce targeted recommendations.
- A “support bundle” can be copied/exported and includes Graph correlation IDs while redacting secrets.
