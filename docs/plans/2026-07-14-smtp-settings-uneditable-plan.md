# Outbound SMTP settings fields are uneditable on appliance installs

**Branch:** `fix/dee-smtp-issue`
**Date:** 2026-07-14

## Problem

A customer on a current appliance build reports that the Outbound Email → SMTP
Configuration fields will not accept typed input. The fields focus, and the
browser's own autofill history drops down, but no characters ever appear.

The screen is not merely hard to type into — it is entirely inert. Save and Test
Connection are dead on the same screen, for the same reason.

This is not an email-delivery bug. Nothing is wrong with SMTP, the network, or
the credentials. The screen has no data object to write into.

## Root cause

`tenant_email_settings.provider_configs` is an empty array, so the screen cannot
find an SMTP provider config, and its change handler silently discards every
keystroke.

The chain:

1. Tenant creation inserts a settings row with **no providers**.
   `ee/temporal-workflows/src/db/tenant-operations.ts:425` inserts
   `email_provider: 'resend'` and omits `provider_configs` entirely, so it takes
   the column default `'[]'::json`
   (`server/migrations/20250601000000_create_email_system_tables.cjs:13`).
   The appliance runs this **same** Temporal workflow — `appliance-bootstrap-configmap.yaml:194`
   shells out to `server/scripts/appliance-create-tenant.mjs`, which starts
   `tenantCreationWorkflow`. There is no on-prem-specific seed path.

2. The existing row defeats the only fallback. `getEmailSettings`
   (`packages/integrations/src/actions/email-actions/emailSettingsActions.ts:79-108`)
   fabricates a default SMTP entry from env vars **only when no row exists at
   all**. A row does exist, so it returns `providerConfigs: []` untouched.

3. The screen finds nothing. `getSmtpConfig()`
   (`ee/server/src/components/settings/email/ManagedEmailSettings.tsx:443`)
   does `providerConfigs.find(c => c.providerType === 'smtp')` → `undefined`.

4. **The inputs render anyway and eat the typing.** They read through optional
   chaining — `value={smtpConfig?.config.host || ''}` (`:748`) — so they render
   as normal, enabled, focusable inputs. But `updateSmtpField` opens with
   `if (!smtpConfig) return;` (`:450`). Every keystroke is discarded and React
   re-renders the value back to `''`. `persistSmtpSettings` early-returns the
   same way (`:462`), so Save and Test Connection no-op too.

5. **There is no escape hatch.** The only code that creates a missing SMTP entry
   is `handleProviderSwitch` (`:412-421`), reachable solely through the provider
   selector, which is gated behind `canUseManagedEmail` (`:650`). On an appliance
   that entitlement is off — which is why the customer's screenshot shows "SMTP"
   as static text with no dropdown. The user can never reach the code that would
   create the entry.

### Why appliances specifically

With `canUseManagedEmail: false` the screen forces `outboundProvider = 'smtp'`
(`:131`, `:201`) regardless of the stored `email_provider`. So the SMTP card
renders (`:731`) even though the row says `resend` with an empty provider list.
On managed/hosted EE, `emailProvider` stays `resend`, the SMTP card never
renders, and the defect stays invisible.

### Two further defects found on the way

- **`persistSmtpSettings` never enables the provider it saves.** It sends
  `emailProvider: 'smtp'` but passes `providerConfigs` through unchanged
  (`:460-466`), never setting `isEnabled: true` on the SMTP entry. A config saved
  while disabled leaves `EmailProviderManager` with no enabled provider, which
  makes it **silently fall back to the system env relay**
  (`packages/email/src/providers/EmailProviderManager.ts:60-63`). Mail appears to
  send, from the wrong server.

- **CE has a milder form of the same disease.** `getCurrentProviderConfig`
  (`packages/integrations/src/components/email/admin/EmailSettings.tsx:248`)
  requires `providerType === selectedProvider && config.isEnabled`, and
  `selectedProvider` is initialized to `'smtp'` (`:67`) but never synced from the
  loaded settings. With an empty provider list the SMTP form simply does not
  render; and since the dropdown already reads "SMTP", re-selecting SMTP fires no
  change event, so the user escapes only by toggling to Resend and back.

### A second writer of the same bad row

`ManagedDomainService.activateDomain`
(`packages/integrations/src/email/domains/services/ManagedDomainService.ts:323-332`)
also inserts `email_provider: 'resend'`, `provider_configs: '[]'` when no row
exists. Writers of this bad shape will keep appearing, which is why the durable
fix belongs at the read/write boundary rather than in a hunt for every writer.

### Explicitly NOT the cause

Two claims in the circulating troubleshooting notes are stale and should not
drive this work:

- The `***`-masked-password clobber **is already fixed** by `mergeProviderSecrets`
  (`emailSettingsActions.ts:28-51`, commit `0eb87e167a`, 2026-07-01). Both CE and
  EE send the `***` sentinel and both go through that same protected action,
  which restores the stored secret before writing. Re-entering the password on
  every save is no longer necessary.
- Test Connection buttons and TLS controls **already exist** in both screens —
  visible in the customer's own screenshot.

## Design

One invariant, enforced at the boundaries rather than in each screen:

> **A settings screen never renders an input without a backing config object, and
> the provider named by `email_provider` always has an enabled config entry.**

Three layers:

1. **Read boundary** (`getEmailSettings`) — guarantee the returned
   `providerConfigs` contains a well-formed entry for every provider type the
   settings UI can edit, whether or not a row exists. Existing entries are
   preserved untouched; only missing ones are materialized. Nothing is written to
   the database on read.

2. **Write boundary** (`updateEmailSettings`) — when the caller supplies
   `emailProvider`, enforce enablement consistency: the entry matching that
   provider type is enabled, the others are not. No client can persist the
   "configured but disabled" state that silently reroutes mail to the system
   relay.

3. **Clients** — never gate an input on the presence of data the handler could
   create. `updateSmtpField` creates the entry on write instead of returning.

Because `persistSmtpSettings` already sends `emailProvider: 'smtp'` plus the full
provider array, **the bad row repairs itself on the first successful save.** No
backfill migration is required. Existing broken tenants (including the customer's)
are fixed the moment they use the now-working screen.

Separately, fix the seed so new appliance tenants never start in the bad shape.

### Seed decisions (agreed)

- **Provider selection is an explicit workflow input, not inferred from ambient
  env.** `appliance-create-tenant.mjs` passes `emailProvider: 'smtp'`; hosted
  callers keep today's `'resend'` default. The appliance declares its own intent
  rather than having the seed guess from `EMAIL_HOST`.
- **Do not pre-fill SMTP details from `EMAIL_*` env.** Seed a blank but
  well-formed SMTP entry. The admin fills the form.
- **Seed the entry as `isEnabled: false`.** An empty config must not be
  "enabled" — enabling an unconfigured provider would make `EmailProviderManager`
  select it and fail every send. Left disabled, the manager keeps today's
  behavior (system-relay fallback) until the admin saves real settings, at which
  point the write boundary enables it. This keeps a fresh appliance's behavior
  identical to today's, so the seed change carries no regression risk for
  out-of-the-box sending.

## Changes

### 1. Shared default-config factory (new)

The default shape for a provider config is currently written out three times
(`emailSettingsActions.ts:82-92`, CE `EmailSettings.tsx:211-222`, EE
`ManagedEmailSettings.tsx:415-421`). Extract one factory and use it everywhere:

- **New:** `createDefaultProviderConfig(providerType, { isEnabled })` in
  `packages/email` (exported for use by both the actions and the UI packages).
  Returns `{ providerId: '<type>-provider', providerType, isEnabled, config }`
  with the per-type empty config (`{ host: '', port: 587, username: '',
  password: '', from: '' }` for smtp; `{ apiKey: '', from: '' }` for resend).
- Replace all three inline copies with calls to it.

### 2. Read boundary — `packages/integrations/src/actions/email-actions/emailSettingsActions.ts`

- Add `withEditableProviderConfigs(settings)`: returns settings whose
  `providerConfigs` contains an entry for each UI-editable provider type
  (`smtp`, `resend`). Existing entries pass through unchanged; missing ones are
  materialized via the factory with `isEnabled: providerType === emailProvider`.
- Apply it to the existing-row path in `getEmailSettings` (after the `***`
  masking at `:112-124`), and rebuild the no-row default path on top of it so the
  two paths share one shape. Preserve the current env-derived host/port/username/
  from behavior for the no-row case, and keep not exposing `EMAIL_PASSWORD`.

### 3. Write boundary — same file, `updateEmailSettings`

- After `mergeProviderSecrets` (`:155-164`), when `updates.emailProvider` is
  present, normalize enablement: `isEnabled = (config.providerType === emailProvider)`
  across the merged array.
- `mergeProviderSecrets` itself is unchanged — it is correct.

### 4. EE screen — `ee/server/src/components/settings/email/ManagedEmailSettings.tsx`

- `updateSmtpField` (`:447`): replace `if (!smtpConfig) return;` with
  create-on-write — if no SMTP entry exists, append one from the factory and
  apply the field to it.
- `persistSmtpSettings` (`:460`): create the entry if absent rather than
  returning `null`, and mark the SMTP config enabled (others disabled) in the
  payload so the UI's local state matches what the write boundary will persist.
- Replace the inline default in `handleProviderSwitch` (`:415`) with the factory.

### 5. CE screen — `packages/integrations/src/components/email/admin/EmailSettings.tsx`

- Sync `selectedProvider` from `settings.emailProvider` when settings load
  (`:87`); today it stays stuck on its `'smtp'` initial value.
- `getCurrentProviderConfig` (`:248`): match on `providerType === selectedProvider`
  only. Drop the `isEnabled` requirement — enablement is a save-time concern and
  must not decide whether a form renders.
- Replace the inline default in `handleProviderChange` (`:211`) with the factory.

### 6. Seed — appliance defaults to SMTP

- `ee/temporal-workflows/src/db/tenant-operations.ts:425`: take `emailProvider`
  from the activity input (default `'resend'`, preserving hosted behavior), and
  seed `provider_configs` with a well-formed, **disabled**, empty entry for that
  provider type via the factory. Plumb the optional `emailProvider` field through
  the workflow input → `SetupTenantDataActivityInput` type chain.
- `server/scripts/appliance-create-tenant.mjs:90-116`: pass `emailProvider: 'smtp'`
  in the workflow input.
- Leave the `try/catch` non-blocking behavior as is, but ensure the failure log
  stays accurate.

## Testing

Unit:

- `getEmailSettings` returns a well-formed SMTP entry when the row exists with
  `provider_configs: []` (the customer's exact state), and when the row has only
  a `resend` entry. Existing configured entries are returned untouched, and
  secret masking still applies.
- `updateEmailSettings` enables exactly the config named by `emailProvider` and
  disables the others; a payload with a configured-but-disabled SMTP entry
  persists it enabled.
- `mergeProviderSecrets` still preserves a `***` password across the new
  enablement normalization (regression guard on the July 1 fix).
- `setupTenantDataInDB` seeds `email_provider: 'smtp'` with a blank disabled SMTP
  entry when given `emailProvider: 'smtp'`, and keeps `'resend'` by default.

Component (EE screen, jsdom):

- With `providerConfigs: []` and `canUseManagedEmail: false`, typing into SMTP
  Host updates state — the direct regression test for the reported bug.
- Saving from that state sends an SMTP entry marked enabled.

Manual verification (the reproduction we deliberately did not run during design):

1. Set a local tenant's `provider_configs` to `[]` and `email_provider` to
   `'resend'` to reproduce the customer's exact row.
2. Load `/msp/settings/email` → Outbound Email with the managed-email entitlement
   off. Confirm fields are typable, Save persists, and Test Connection runs.
3. Confirm the DB row afterwards has a populated, **enabled** SMTP entry and
   `email_provider: 'smtp'`.
4. Restore the original row.

## Out of scope

- Rows already corrupted by a pre-July-1 build storing a literal `***` password.
  Those cannot self-heal; the admin must retype the password. Worth a support
  note, not code.
- The generic error string returned by `TenantEmailService.testConnection`
  (`:411`), which hides the real nodemailer failure (EAUTH vs ECONNREFUSED vs
  self-signed cert) behind one message. Real diagnosability problem, separate
  change.
- The silent system-relay fallback in `EmailProviderManager` (`:60-63`) as a
  design question. This plan stops the *new* way of falling into it; it does not
  remove the fallback.
- The orphaned duplicate `server/src/services/email/providers/SMTPEmailProvider.ts`
  (zero importers).

## Risks

- **Enablement normalization** assumes a single active outbound provider. That
  matches the data model (`emailProvider: 'smtp' | 'resend'`) and
  `EmailProviderManager`, which selects the first enabled config. Low risk.
- **The read boundary materializes a blank `resend` entry** for SMTP tenants,
  which a subsequent save will persist. It is inert while disabled, and it makes
  provider switching robust. Acceptable.
- **No migration**, so existing broken tenants stay broken in the database until
  an admin opens the screen and saves. That is the intended self-healing design
  and it is what unblocks the customer.
