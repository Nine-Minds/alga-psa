# Email sender identity: defaults and portal-invite display name

**Branch:** `fix/outbound-email-branding`  
**Date:** 2026-08-04  
**Status:** Design complete; no feature code implemented

## Outcome

Make outbound sender identity predictable without collapsing two deliberately
different concerns:

1. **Ticket identity** controls the From address/name used on ticket email and,
   critically, the inbox to which a client's reply is routed.
2. **Everything-else identity** brands portal invitations, password resets,
   billing mail, workflow mail, and general notifications sent through the
   tenant's active outbound provider.

The settings screen must show these identities side by side and explain the
routing difference. A blank everything-else display name means “use the tenant's
company name,” not “use Alga PSA.” A portal invitation's explicit
`<Tenant Company> Portal` name must override that ordinary notification default.

## Confirmed repository behavior

- `packages/email/src/TenantEmailService.ts`
  - `getProviderConfiguredAddress()` already reads the enabled provider's
    `config.from` and `config.fromName`/`config.from_name`.
  - `getDefaultFromAddress()` currently falls back from provider name to
    `EMAIL_FROM`, `EMAIL_FROM_NAME`, and finally `Alga PSA Notifications`; it has
    no tenant-company lookup.
  - `getFromAddress()` honors `params.from`, but does not independently apply the
    already-declared `fromName` parameter.
  - static `sendEmail()` omits `fromName` when it builds `BaseEmailParams`.
  - `testConnection()` builds its test message with the hard-coded name
    `Alga PSA`, bypassing the tenant default.
- `packages/email/src/sendPortalInvitationEmail.ts` accepts `fromName`, renames
  it to `_fromName`, and never puts it into either the tenant-provider attempt or
  the system-provider fallback.
- `packages/portal-shared/src/actions/portalInvitationActions.ts` does compute
  `${tenantDefaultClient.client_name} Portal` at the `sendPortalInvitationEmail`
  call. The value is correct at the caller and is lost in the email helper.
- `packages/integrations/src/actions/email-actions/emailSettingsActions.ts`
  persists ticket identity in `tenant_email_settings.ticketing_from_email` and
  `ticketing_from_name`, while ordinary outbound identity lives in the enabled
  provider JSON as `config.from`/`config.fromName`.
  - Its Microsoft branch currently sets `nextTicketingFromEmail` to the selected
    outbound mailbox. Choosing an outbound transport therefore silently mutates
    ticket routing.
  - The same branch rebuilds the Microsoft provider config and copies
    `email_providers.sender_display_name` into `config.fromName`, so it must be
    careful not to discard an independently edited notification name.
- `server/src/lib/eventBus/subscribers/ticketEmailSubscriber.ts`
  `resolveTicketingFromAddress()` is the ticket-only resolver. It correctly
  prefers `ticketingFromName`, then a matching inbound provider's
  `sender_display_name`, while the caller retains board-name/`Support` fallback.
  This path must remain ticket-specific.
- `packages/email/src/providers/SMTPEmailProvider.ts` and
  `packages/email/src/providers/ResendEmailProvider.ts` both serialize
  `EmailMessage.from.name`; they need no provider-specific branding logic.
- `packages/email/src/providers/MicrosoftGraphEmailProvider.ts`
  - The JSON Graph payload does not include the message's From name.
  - The MIME path explicitly renders `message.from.name` with the selected
    Microsoft mailbox. Ticket mail already takes this path because of threading
    headers; ordinary notifications do not.
- The two edition screens have diverged:
  - CE/OSS: `packages/integrations/src/components/email/admin/EmailSettings.tsx`
    exposes provider From addresses but no ticket-identity editor and no display
    name field.
  - EE: `ee/server/src/components/settings/email/ManagedEmailSettings.tsx`
    has a separate Ticketing From card below provider configuration, but ordinary
    notification identity is implicit and not displayed beside it.
- No schema change is required. The two identities already have separate storage:
  ticket columns plus provider-config JSON.

## Binding identity rules

| Mail class | From address | Display-name precedence | Reply/routing meaning |
| --- | --- | --- | --- |
| Ticket mail | `ticketingFromEmail` when configured; otherwise the active outbound address | `ticketingFromName` → matching inbound provider `sender_display_name` → ticket board name → `Support` | Prefer a monitored inbound inbox so replies re-enter the correct ticket flow. |
| Everything else | Active provider `config.from`, or the existing environment/domain-derived default | per-message `fromName` override → provider `config.fromName`/name embedded in `config.from` → tenant company → environment name → `Alga PSA Notifications` | Branding only; it must not change ticket reply routing. |
| Portal invitation | Same address as ordinary outbound mail | explicit `${tenant company} Portal`, including on system-provider fallback | Reply-To remains the configured MSP support address. |

For Microsoft 365, Exchange constrains the wire From address to the selected
mailbox. Ticket and everything-else names remain independent, but a configured
ticket address must be that mailbox because the Graph provider cannot safely
spoof an arbitrary address. The UI and server validation should state this
capability constraint instead of silently rewriting ticket settings.

## Data and API design

### Reuse existing persisted fields

- Keep `tenant_email_settings.ticketing_from_email` and
  `tenant_email_settings.ticketing_from_name` exclusively for ticket mail.
- Keep ordinary outbound `from` and `fromName` in the active
  `EmailProviderConfig.config` object for SMTP, Resend, and Microsoft.
- Do not add a `notification_from_*` column, copy the company name into the
  database as a fake explicit override, or backfill existing tenants. Leaving
  `fromName` blank must remain a live fallback so a tenant-company rename is
  reflected without rewriting email settings.

### Add one shared resolver

Create `packages/email/src/senderIdentity.ts` and export it through
`packages/email/src/index.ts`:

- `resolveTenantCompanyName(knex, tenantId)` reads the default
  `tenant_companies` row, tenant-joins `clients`, and returns trimmed
  `clients.client_name`; fall back to the tenant record's current company/client
  name, then `null`. All queries use `tenantDb`/`tenantJoin`.
- `resolveDefaultFromAddress(settings, tenantCompanyName)` contains the current
  address parsing/domain re-homing behavior and the new display-name precedence.
  Keep this part pure so provider/address cases remain cheap unit tests.
- `applyFromNameOverride(address, fromName)` changes only the display name and
  never substitutes a tenant address into a system provider. This is important
  for fallback delivery from a platform-owned domain.

Add an action-level view type in
`packages/integrations/src/actions/email-actions/emailSettingsActions.ts`, for
example `EmailSettingsView`, containing the persisted `TenantEmailSettings` plus:

- `tenantCompanyName: string | null`
- `effectiveNotificationFrom: EmailAddress`

`getEmailSettings()` and the result returned by `updateEmailSettings()` populate
those computed values without persisting them. Both CE and EE can therefore show
the actual effective identity, including a derived managed-Resend address, while
editing only real stored fields.

## Implementation order

### 1. Centralize ordinary sender resolution

Files:

- New `packages/email/src/senderIdentity.ts`
- `packages/email/src/TenantEmailService.ts`
- `packages/email/src/index.ts`
- `packages/email/src/BaseEmailService.ts`

Changes:

1. Move the pure parsing, provider-address, domain, and local-part helpers out of
   `TenantEmailService.ts` into `senderIdentity.ts`.
2. Add `fromName?: string` explicitly to `BaseEmailParams`; keep `from` as the
   address override and `fromName` as a name-only override.
3. In `TenantEmailService.sendEmail()`, reuse the connection already opened for
   the suspension check and resolve the tenant company before calling
   `super.sendEmail()`. Pass it on that call's params as an internal resolved
   fallback (for example `resolvedTenantCompanyName`), rather than mutating the
   tenant singleton or creating a long-lived company-name cache, so concurrent
   sends stay isolated and default-client/name changes take effect on later
   messages. Run the suspension and company reads together when safe.
4. Update `TenantEmailService.getFromAddress()` so `fromName` overrides the name
   on either an explicit `params.from` address or the resolved default address,
   and the call-scoped resolved company supplies the fallback, without changing
   the email address.
5. Keep `TenantEmailService.getDefaultFromAddress()` as a compatibility wrapper
   for the ticket subscriber/tests, accepting the resolved company name when a
   full identity (rather than only its email) is needed.
6. Forward `fromName` in the deprecated static `TenantEmailService.sendEmail()`
   path as well; verification and other legacy callers must not silently lose it.
7. Change `TenantEmailService.testConnection()` to use the same effective
   identity instead of `{ name: 'Alga PSA' }`.

### 2. Make explicit display-name overrides survive tenant and system sending

Files:

- `packages/email/src/system/SystemEmailService.ts`
- `packages/email/src/sendPortalInvitationEmail.ts`
- `packages/portal-shared/src/actions/portalInvitationActions.ts`

Changes:

1. Make `SystemEmailService.getFromAddress()` return an `EmailAddress` when
   needed and apply `params.fromName` to the system provider's own configured
   From email. Never send a tenant's provider address through the fallback.
2. Stop destructuring `fromName` as `_fromName` in
   `sendPortalInvitationEmail()`; include it in the shared `emailParams` used by
   both attempts.
3. Retain the existing portal action computation
   `` `${tenantDefaultClient.client_name} Portal` `` and existing support
   Reply-To. No portal template or invitation transaction behavior changes.
4. Add a narrow regression test at both seams: the portal action computes the
   expected value, and the email helper forwards it to the tenant attempt and to
   the fallback after an injected tenant-provider failure.

### 3. Preserve ticket routing during provider changes

Files:

- `packages/integrations/src/actions/email-actions/emailSettingsActions.ts`
- `packages/integrations/src/actions/email-actions/emailSettingsActions.providers.test.ts`
- `packages/integrations/src/actions/email-actions/emailSettingsActions.clear.test.ts`

Changes:

1. Remove the Microsoft-selection assignment to `nextTicketingFromEmail`.
   Provider selection may update `emailProvider`, `defaultFromDomain`, and the
   Microsoft provider config, but not either `ticketingFrom*` field unless the
   caller explicitly supplies those fields.
2. When rebuilding a validated Microsoft config, preserve the submitted
   notification `config.fromName` after trimming. If it is blank, leave it blank
   so runtime company fallback applies; do not convert the fallback into stored
   state. The inbound row's `sender_display_name` remains an initial suggestion,
   not a forced coupling to ticket identity.
3. Add Microsoft-specific validation: a non-null ticket From address must equal
   the selected mailbox (case-insensitive). Return an actionable error that asks
   the admin to update the Ticket emails identity; do not rewrite it.
4. Preserve the existing domain validation for SMTP/Resend and the partial-update
   semantics established by `hasOwnUpdate()`.
5. Have `getEmailSettings()` resolve `tenantCompanyName` and
   `effectiveNotificationFrom`, including the no-row/default-config path, and
   return the same enriched view after saves.

### 4. Carry display names on the Microsoft Graph wire path

Files:

- `packages/email/src/providers/MicrosoftGraphEmailProvider.ts`
- `packages/email/src/providers/__tests__/MicrosoftGraphEmailProvider.test.ts`

Changes:

1. Extend `buildSendPayload()` so a nonblank `message.from.name` selects MIME,
   even when no ticket-threading header requires MIME. The existing
   `buildMimeMessage()` already pins the email address to `this.mailbox` and
   renders the supplied name.
2. Retain Graph JSON for genuinely nameless messages with only JSON-compatible
   headers; do not add arbitrary From spoofing to the JSON payload.
3. Keep the existing MIME selection for Message-ID/In-Reply-To/References and
   preserve attachments, Cc/Bcc, Reply-To, and Sent Items behavior.
4. Test the raw decoded MIME header for both ordinary tenant branding and the
   explicit `Company Portal` override. Retain a nameless JSON-path test so both
   transports stay covered.

### 5. Put both identities side by side in CE and EE settings

Files:

- New `packages/integrations/src/components/email/admin/EmailSenderIdentityCards.tsx`
- `packages/integrations/src/components/email/admin/EmailSettings.tsx`
- `ee/server/src/components/settings/email/ManagedEmailSettings.tsx`
- `server/public/locales/*/msp/admin.json`
- `server/public/locales/*/msp/email-providers.json`

Create a shared presentational component rendered as a responsive two-column
grid (stacked on narrow screens):

- **Ticket emails**
  - From address (connected-inbox selector plus custom input where currently
    supported)
  - Sender display name
  - Copy explaining that this address receives ticket replies and should be a
    connected/monitored inbox
  - Existing warnings/errors for unconnected inboxes and invalid domains
- **All other emails**
  - Effective From address
  - Sender display name bound to active provider `config.fromName`
  - Help text: blank uses the tenant company name, shown as the live fallback
  - Examples in the explanation: portal invitations, password resets, invoices,
    and general notifications

Provider rules in the component:

- SMTP and customer-managed Resend keep their editable provider From address.
- Managed Resend shows the effective address derived from its verified domain;
  it must not invent an editable provider address the managed flow cannot honor.
- Microsoft shows the selected mailbox as a locked address, while its ordinary
  display name remains independently editable.
- Ticket fields always bind to `ticketingFromEmail`/`ticketingFromName`; ordinary
  fields always bind to the active provider config. Editing one card must not
  mutate the other card's state.

Integration in the parent screens:

1. In CE `EmailSettings`, remove duplicate SMTP/Resend From-address markup from
   `renderSMTPConfig()`/`renderResendConfig()`, load connected inbound providers,
   render the shared identity cards, and let the existing Save Settings action
   persist the combined state.
2. In EE `ManagedEmailSettings`, replace the standalone Ticketing From card and
   the SMTP card's duplicate From field with the shared identity cards. Replace
   `handleSaveTicketingFrom()` with a sender-identity save that submits the two
   explicitly edited field groups in one `updateEmailSettings()` call; retain
   clear/confirmation behavior for ticket identity.
3. Keep provider credentials, TLS controls, managed-domain controls, test-send
   controls, and Microsoft mailbox selection in their existing provider cards.
4. Use stable ids for automation, including `#ticket-from-address`,
   `#ticket-from-name`, `#notification-from-address`,
   `#notification-from-name`, and `#save-sender-identities` (EE).
5. Add equivalent copy keys to the CE `msp/admin` and EE
   `msp/email-providers` namespaces, including supported/pseudo locale files as
   required by the repository's locale consistency checks.

### 6. Verify all provider paths and regressions

Land the automated tests below before manual smoke. Run package-level typechecks
for `packages/email` and `packages/integrations`, EE/server typecheck, the focused
Vitest files, and the repository locale/format checks that cover changed files.

## Automated behavioral tests

### Pure/service tests

Extend `packages/email/src/__tests__/TenantEmailService.fromAddress.test.ts`:

1. Provider `fromName` wins over tenant company.
2. Blank provider name uses the tenant company for SMTP and Resend.
3. Tenant company wins over environment/product branding; environment/product
   remain last-resort fallbacks when the tenant has no resolvable company.
4. A per-message `fromName` changes only the name, not the resolved email.
5. An explicit ticket `from` object retains its ticket name unless a deliberate
   per-message name override is passed.
6. Test email uses the same resolved ordinary identity.

Add a DB-backed integration test at
`server/src/test/integration/emailSenderIdentity.integration.test.ts`:

- Happy path: a real tenant/default-company/client/settings fixture with blank
  provider `fromName` resolves the default client's current name and provider
  address through real tenant-scoped queries.
- Guard path: no default-company association falls back to the tenant record and
  never reads another tenant's company.
- Update the default company's name and prove a later send resolution observes
  it without persisting that name into `provider_configs`.

### Portal-invitation tests

Add `packages/email/src/__tests__/sendPortalInvitationEmail.test.ts` and a focused
portal-action test under `packages/portal-shared/src/actions/`:

1. `sendPortalInvitation` computes `Example MSP Portal` from the default tenant
   company.
2. `sendPortalInvitationEmail` passes that name to the successful tenant send.
3. When the tenant send fails, the system fallback uses its own email address
   with the same `Example MSP Portal` display name.
4. Support Reply-To, locale resolution, and transaction rollback on total
   failure remain unchanged.

### Provider tests

- Extend `packages/email/src/providers/__tests__/SMTPEmailProvider.test.ts` and
  `ResendEmailProvider.test.ts` to assert the serialized named From value for the
  tenant default and an explicit portal override.
- Extend `MicrosoftGraphEmailProvider.test.ts` as described in implementation
  step 4: ordinary named notification → MIME, portal override → MIME with the
  selected mailbox, threading headers still present for tickets, nameless mail →
  JSON.
- Extend `emailSettingsActions.providers.test.ts` so Microsoft selection:
  - preserves existing `ticketingFromEmail` and `ticketingFromName` when they are
    compatible;
  - never writes those fields merely because a mailbox was selected;
  - rejects an incompatible existing ticket address instead of overwriting it;
  - preserves/clears ordinary `config.fromName` with the intended fallback
    semantics.

### Component tests

- Add a CE jsdom test beside
  `packages/integrations/src/components/email/admin/EmailSettings.tsx`.
- Extend
  `ee/server/src/__tests__/unit/ManagedEmailSettings.actions.test.tsx`.

Both editions must prove:

1. Ticket emails and All other emails render side by side with the routing
   explanation.
2. Editing/saving notification name does not change either ticket field.
3. Editing/saving ticket name/address does not change provider `fromName`/`from`.
4. Blank notification name visibly previews the tenant-company fallback.
5. Microsoft mailbox address is read-only while notification name is editable.
6. Reloading after save reconstructs the same stored/effective split rather than
   relying on optimistic component state.

## Manual smoke plan

The smoke steps below are derived from the current components and intended
post-change behavior; no live screen was driven during this design-only task.

### Preflight

- Use the existing `alga-psa-local-test` Compose project.
- The worktree dev server is `http://localhost:3305`.
- Host-run wire-in configuration is `server/.env.local`.
- Use a tenant whose default company is visibly named (for example
  `Example MSP`) and an SMTP/Graph capture path where raw From and Reply-To
  headers can be inspected. The seeded login password rotates per stack boot;
  take it from the server boot banner.

### Risks this smoke defends

- Ticket replies silently route to the wrong mailbox after changing outbound
  provider.
- Clients see Alga/platform branding instead of the MSP's company name.
- Portal invitations report success while discarding the computed Portal name.
- Microsoft accepts the message but Exchange emits a different display name.
- The settings screen looks correct optimistically but persists the identities
  into the wrong fields.

### Flow 1 — prevent identity fields from crossing on save

1. Open `/msp/settings/email` → **Outbound Email**.
2. Confirm **Ticket emails** and **All other emails** are visible side by side and
   their explanations distinguish reply routing from branding.
3. Set ticket identity to `support@example.test` / `Example Support`; set the
   everything-else name to `Example MSP`; save.
4. Reload the page. Both cards must retain their own values.
5. Out-of-band, inspect `tenant_email_settings`: the ticket values must be in
   `ticketing_from_email`/`ticketing_from_name`; the ordinary name/address must be
   only in the active `provider_configs[].config`.

### Flow 2 — prevent platform branding when ordinary name is blank

1. Clear the **All other emails** display name but keep a valid SMTP From address;
   save and reload.
2. The card must show `Example MSP` as the effective fallback without storing it
   as an explicit provider `fromName`.
3. Send a test email from the existing **Test Outbound Email** control.
4. Inspect the raw captured message. From must be `Example MSP <configured
   address>`, never `Alga PSA` or `Alga PSA Notifications`.

### Flow 3 — prevent portal-invite branding loss

1. Open a client contact → **Portal** tab and click **Send Portal Invitation**
   (`#send-invite-button`).
2. Confirm the UI reports success and invitation history gains the invitation.
3. Inspect the raw message: From name is `Example MSP Portal`, the address is the
   active ordinary outbound address, and Reply-To is the configured MSP support
   address.
4. This must remain true with blank provider display name. In a controlled test
   where the tenant provider fails and system fallback succeeds, the fallback's
   address must remain platform-owned while its display name is still
   `Example MSP Portal`.

### Flow 4 — prevent ticket-routing regression

1. From a ticket on a board with a distinct name, send a public reply or trigger a
   ticket notification.
2. Inspect the raw From header: it uses `Example Support
   <support@example.test>`, not `Example MSP` or `Example MSP Portal`.
3. Reply from the recipient mailbox and confirm the reply is ingested into the
   same ticket through the connected support inbox.
4. Re-open settings and confirm the everything-else identity did not change.

### Flow 5 — prevent Microsoft Graph from discarding names

1. Select an authorized Microsoft 365 outbound mailbox.
2. If the saved ticket address is a different mailbox, the save must stop with an
   actionable message; it must not silently replace the ticket field.
3. Set the ordinary display name to `Example MSP` and send a non-ticket test or
   notification. Confirm delivery/Sent Items and raw From
   `Example MSP <selected-mailbox>`.
4. Send a ticket reply with ticket display name `Example Support`; confirm raw
   From `Example Support <selected-mailbox>` and preserved threading headers.
5. Send a portal invitation; confirm `Example MSP Portal <selected-mailbox>`.

### Manual pass criteria

The smoke passes only if raw delivered headers, reloaded UI state, and the
tenant-scoped DB row agree: ticket routing remains in the ticket fields; ordinary
branding remains in provider config with live company fallback; portal override
survives; and SMTP/Resend/Microsoft all emit the intended display name.

## Risks and mitigations

- **One extra tenant-company read per send.** Correctness after a default-company
  rename is more important than a stale singleton cache. Reuse the connection
  already opened by `TenantEmailService.sendEmail`, keep the query narrow, and
  measure it in focused tests; do not add a cross-tenant/global cache.
- **Microsoft MIME expansion.** Once default names are populated, most Microsoft
  sends will use MIME rather than JSON. Existing ticket sends already exercise
  MIME. Provider tests must cover attachments, recipients, Reply-To, and headers
  on the newly expanded path.
- **Microsoft cannot honor arbitrary From addresses.** Enforce mailbox equality
  for ticket address rather than implying Graph can spoof it. Names remain
  independent.
- **System fallback domain safety.** A name override must never carry a tenant
  address into the system provider; `applyFromNameOverride` is deliberately
  address-preserving.
- **CE/EE UI drift.** Use one shared identity-card component and edition-specific
  parent wiring rather than copying the identity form a third time.
- **Partial updates and secret masking.** Sender saves still flow through
  `mergeProviderSecrets`; regression tests must retain the `***` password/API-key
  protections.
- **Default-company absence.** Keep environment and product fallbacks after the
  company lookup so a partially provisioned tenant can still send.

## Explicit non-goals

- No feature implementation or workflow-board mutation in this design task.
- No database migration, backfill, or rewriting blank provider names to company
  names.
- No change to inbound provider setup, webhook processing, ticket parsing,
  ticket threading, or `email_providers.sender_display_name` semantics.
- No arbitrary Microsoft From spoofing, extra mailbox discovery, OAuth-scope
  changes, or Send As permission work.
- No changes to SMTP credentials/TLS, Resend domain verification, managed-domain
  lifecycle, rate limits, or provider failover policy.
- No email-template content/subject redesign and no change to portal invitation
  token, expiration, locale, transaction, support contact, or Reply-To behavior.
- No per-template or per-notification-category sender identities; there remain
  exactly the ticket identity, the everything-else identity, and deliberate
  per-message name overrides such as Company Portal.
