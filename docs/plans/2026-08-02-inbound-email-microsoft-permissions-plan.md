# Inbound Email Microsoft/Entra Documentation Accuracy Plan

Date: 2026-08-02
Ticket: alga0002218 — Inbound email docs: remove stale “coming soon” entries, close Graph API permission gaps

## Objective

Make the inbound-email documentation a reliable setup path for an MSP administrator configuring Microsoft 365 ingestion. Remove stale index labels, clearly distinguish the permissions used by the inbound OAuth flow from broader Microsoft integration metadata, and explain shared-mailbox, consent, webhook, hosted, and self-hosted behavior without claiming capabilities the product does not provide.

## Evidence and constraints

- `docs/inbound-email/README.md` labels `setup/imap.md` and `architecture/overall.md` as coming soon even though both files exist.
- `docs/inbound-email/setup/microsoft.md` currently names the actual delegated inbound scopes (`Mail.Read`, `Mail.Read.Shared`, `offline_access`) and describes webhook-to-polling fallback, but does not explain what each permission enables or how tenant consent policy affects authorization.
- The production inbound OAuth helpers and callback request exactly `Mail.Read`, `Mail.Read.Shared`, and `offline_access` (`server/src/utils/email/oauthHelpers.ts`, `server/src/app/api/auth/microsoft/callback/route.ts`, and the mirrored helpers under `packages/integrations`). Microsoft diagnostics validate `Mail.Read` and `Mail.Read.Shared` (`packages/integrations/src/actions/email-actions/emailProviderActions.ts`).
- Microsoft profile metadata currently advertises a broader email scope set including `Mail.ReadWrite` and `Mail.Send` (`packages/integrations/src/actions/integrations/microsoftActions.ts`). That metadata must not be presented as the inbound connector’s runtime requirement: the inbound connector is read-only and its OAuth callback does not request those write/send scopes.
- A shared mailbox is accessed with delegated permissions on behalf of the signed-in user. `Mail.Read.Shared` does not grant mailbox membership by itself; the authorizing user must already have Exchange permission to the shared mailbox.
- Creating and renewing Graph change-notification subscriptions does not require a separate “webhook permission”; it relies on the mail permission for the subscribed resource. A reachable public callback enables webhook delivery, while the application’s polling fallback only needs outbound HTTPS.
- Preserve the pre-existing, unrelated `package-lock.json` modification. This task changes documentation only.

## Implementation steps

### 1. Repair the inbound-email index

Update `docs/inbound-email/README.md`:

- Replace the IMAP “coming soon” entry with a direct link to `setup/imap.md`, using wording that accurately reflects its current scope (in-app processing/configuration flags rather than promising a full OAuth setup guide).
- Remove the “coming soon” marker from `architecture/overall.md` and link it normally.
- Keep the quick-link wording aligned with the actual destination content; do not imply that either page covers more than it does.

### 2. Turn the Microsoft setup page into a permission checklist

Revise `docs/inbound-email/setup/microsoft.md` around prerequisites and app registration:

- Add a compact table for the three delegated permissions:
  - `Mail.Read`: reads the signed-in user’s mailbox and supports message/folder access used by ingestion and subscriptions.
  - `Mail.Read.Shared`: reads shared/delegated mailboxes the signed-in user can already access.
  - `offline_access`: permits refresh tokens so background polling, reconciliation, and subscription renewal continue without an interactive sign-in.
- Explicitly state that all three are **Delegated** permissions for this flow; do not instruct administrators to add application permissions, `Mail.ReadWrite`, or `Mail.Send` for inbound ingestion.
- Explain consent accurately: grant tenant-wide admin consent when the tenant’s policies require it or when the administrator wants to avoid per-user consent prompts, but do not claim admin consent is universally mandatory for delegated `Mail.Read`/`Mail.Read.Shared`.
- Add a pre-authorization checklist: exact Web redirect URI, supported account audience, secret value (not secret ID), Email consumer binding, and mailbox access for the user who will authorize.

### 3. Document shared-mailbox authorization as a separate path

Extend `docs/inbound-email/setup/microsoft.md` with a focused shared-mailbox subsection:

- Require the provider’s mailbox address to be the shared mailbox and the interactive OAuth user to be a real licensed/user identity with Exchange access to it.
- State that `Mail.Read.Shared` authorizes Graph to act within the user’s existing delegated mailbox access; it does not assign Full Access or otherwise grant Exchange rights.
- Give a verification sequence before blaming Alga PSA: confirm the user can open the shared mailbox in Outlook/OWA, confirm `Mail.Read.Shared` is present/consented, then reauthorize/test the provider.
- Call out the common failure mode where OAuth succeeds for the user’s own mailbox but Graph returns 403 for the configured shared mailbox.

### 4. Clarify webhook subscriptions and fallback behavior

Refine the runtime and troubleshooting sections in `docs/inbound-email/setup/microsoft.md`:

- Explain that subscriptions are created per watched folder/resource using the same delegated mail access; no additional Graph “webhook” scope is configured.
- Distinguish Microsoft’s validation of the public notification URL from normal message access. Failure to validate the callback should be described as a delivery-mode issue, not a permissions failure.
- Preserve the documented outbound-only polling fallback and its network requirements, but verify all intervals/expiry wording against the current adapter and maintenance code before finalizing exact numbers. If code and prose disagree, update the prose to the current implementation rather than copying historical plan documents.
- Add actionable symptoms: OAuth/consent failure, 403 for shared mailbox, subscription validation failure, and expired/revoked refresh token.

### 5. Make hosted and self-hosted setup paths explicit

Split the existing credentials paragraph in `docs/inbound-email/setup/microsoft.md` into two labeled paths:

- **Hosted:** explain the profile-first flow and the platform-credential fallback only to the extent confirmed by the current configuration builder; make clear that a tenant profile bound to Email takes precedence.
- **Self-hosted/appliance:** direct administrators to create and bind their own Entra profile, register their deployment’s exact callback URL, provide outbound access to Microsoft endpoints, and expose the webhook URL only when webhook delivery is desired. Polling remains valid when inbound reachability is unavailable.
- Avoid exposing environment-variable names as the primary customer setup method; keep them as operator-level fallback/reference details if they remain supported.

### 6. Replace the architecture placeholder with a truthful overview

Update `docs/inbound-email/architecture/overall.md` so removing the index’s “coming soon” marker does not point users to a placeholder:

- Describe the common provider-to-normalized-message-to-ticket pipeline and link to the detailed workflow page.
- Show Microsoft’s OAuth token storage, Graph subscription/webhook path, reconciliation/polling fallback, queue handoff, and ticket creation at a high level.
- Keep Google Pub/Sub and IMAP distinctions brief and link to their dedicated pages; do not duplicate provider-specific setup instructions.
- Include trust-boundary notes: inbound connectors are read-only at the mailbox layer, secrets/tokens are server-side, and webhook requests are validated before queueing.

## Validation

Because this is documentation-only, use behavioral/document-consistency checks rather than source-string tests:

1. Follow the Microsoft guide as a new administrator and confirm every named screen, field, redirect URI, and button exists in the current UI.
2. Cross-check the documented inbound scope list against both OAuth helper implementations and the callback’s token exchange scope.
3. Cross-check subscription resource construction, renewal/expiry timing, reconciliation cadence, polling cadence, and callback route against the current `MicrosoftGraphAdapter` and maintenance jobs.
4. Verify the shared-mailbox troubleshooting advice against the diagnostics path and ensure it distinguishes missing Graph consent from missing Exchange mailbox access.
5. Render all changed Markdown and Mermaid blocks; verify links from `docs/inbound-email/README.md` resolve and no destination is still a placeholder while advertised as complete.
6. Run the repository’s existing documentation/link validation if available. Do not add a brittle test that only asserts literal documentation strings.

## Definition of done

- The two stale quick-link entries no longer say “coming soon,” and their destination pages accurately describe what exists.
- A reader can identify exactly which delegated Graph permissions inbound ingestion uses, why each is needed, and which broader Microsoft scopes are not required for this connector.
- Shared-mailbox prerequisites and the boundary between Graph consent and Exchange mailbox access are explicit.
- Admin-consent guidance is conditional on tenant policy rather than presented as universally mandatory.
- Hosted and self-hosted setup paths, webhook reachability, and polling fallback are unambiguous.
- The architecture overview is no longer a placeholder and agrees with the current implementation.
- Only documentation files are changed; the unrelated `package-lock.json` drift remains untouched.
