# Microsoft 365 email setup cleanup — implementation plan

**Date:** 2026-08-04
**Branch:** `chore/microsoft-graph-cleanup`
**Interactive mockup:** [`2026-08-04-microsoft-email-setup-cleanup-mockup.html`](./2026-08-04-microsoft-email-setup-cleanup-mockup.html) — open in a browser; it simulates both redesigned surfaces with toggles for deployment type (hosted / appliance) and Microsoft app state (not set up / consent pending / ready). The mockup is the visual contract for this plan.

## Problem

Microsoft 365 email configuration spans three chained surfaces, but the UI presents them as overlapping, competing implementations:

- **Providers** (Settings → Integrations → Providers) configures the Entra app registration (`microsoft_profiles`, `microsoft_profile_consumer_bindings`).
- **Communication** (Settings → Integrations → Communication) connects a mailbox (`email_providers`, `microsoft_email_provider_config`), consuming the profile from Providers.
- **Outbound Email** picks an already-authorized mailbox (`tenant_email_settings`).

The confusion:

1. The mailbox dialog (`MicrosoftProviderForm`) **re-litigates app-level decisions** that belong to Providers: a platform-managed vs bring-your-own-app choice, a "Microsoft app profile is ready" plumbing notice, and a raw Redirect URI input. The platform/BYO explanation exists three times with drifted wording (mailbox form, provider list page, Providers screen).
2. **No hosted-vs-self-hosted gating.** All "AlgaPSA supplies the application" affordances key off `EDITION === 'enterprise'` (`microsoftConsumerVisibility.ts`). The appliance ships EE, so appliance users see hosted-only options that then fail with "Platform Microsoft credentials are unavailable". In the Providers setup dialog, the platform option renders even when unavailable (disabled with an "Unavailable" badge). The primitive that should gate this (`useTier().isHosted` / self-host licensing) is never used inside `packages/integrations`.
3. **"Tenant" terminology is overloaded.** UI copy uses bare "tenant" ("tenant administrator consent", "tenant-owned app", a bare "Tenant ID" label) meaning the *Microsoft* tenant, in a product where tenant is the internal MSP concept. Internally one interface carries both `tenantId` (Alga) and `microsoftTenantId` (Microsoft).

## Settled design

One sentence: **Providers is the sole home for app-level Microsoft configuration; the Communication mailbox flow is reduced to mailbox facts plus a readiness line plus sign-in, linking out to Providers when the app isn't ready.**

### Providers surface (app-level home)

- **Not set up:** a single "Set up Microsoft" call to action opening the setup wizard.
- **Wizard option list** (order and presence matter):
  1. *"Use the app provided by AlgaPSA"* — **hosted deployments only**, listed first, badged "Recommended". On self-hosted/appliance deployments this option is **not rendered at all** (not disabled-with-badge).
  2. *"Create an app in your Microsoft organization"* — automated Entra provisioning. Becomes the lead option on self-hosted.
  3. *"Enter an existing app manually"* — badged "Advanced". This step is the **only place in the product a Redirect URI appears**, read-only, for copying into the customer's Entra app registration.
- **Consent step** (all paths funnel here): framed as "a **Microsoft 365 administrator** must approve access", with an "Approve in Microsoft" action and a "Copy approval link for your admin" affordance (the person clicking is often not the Microsoft admin).
- **Pending state:** profile card with a "Waiting for admin approval" badge, approve + copy-link actions.
- **Ready state:** profile card with capability chips and a "Connect a mailbox →" hand-off routing to the Communication tab.

### Communication surface (thin mailbox flow)

- Fields: mailbox address, sender display name, existing ticket defaults / advanced sync settings. Nothing app-level.
- One status strip, driven by a single consolidated readiness payload:
  - **Ready:** quiet info line ("Microsoft is set up. Sign in as this mailbox to finish.") and an enabled **"Sign in with Microsoft"** button (rename from "Authorize Access").
  - **Consent pending:** warning ("Waiting for your Microsoft 365 administrator. Setup was started in Providers but hasn't been approved yet.") with an "Open Providers" link; sign-in disabled.
  - **Not set up:** warning ("Microsoft isn't set up yet. Set it up once in Providers, then come back.") with a "Set up in Providers" link; sign-in disabled.
- **Removed entirely from this surface:** the platform-managed alert, the "Use your own Microsoft app (advanced)" expander and its `useByoApp` state, the "Microsoft app profile is ready" notice, and the Redirect URI input.
- The provider list page (`EmailProviderConfiguration`) loses its duplicated platform/BYO setup-instructions block in favor of a one-line pointer to Providers.

### Cross-cutting rules

- **Deployment-aware gating:** hosted-only affordances gate on hosted-ness (self-host licensing), not edition. Edition checks remain only where they genuinely mean edition (EE feature availability).
- **Terminology:** bare "tenant" is banned from user-facing copy in these flows. Use "your Microsoft organization", "Microsoft 365 administrator", or the fully-qualified "Microsoft tenant ID" for the literal field. Alga's internal tenant concept never surfaces.
- **Redirect URI** is computed server-side from the deployment's public base URL; it is never user input.

## Non-goals

- The Outbound Email tab (flow C) is untouched except where it already works (it gates Resend on `isHosted` correctly). The genuine duplication between `ee/server/.../ManagedEmailSettings.tsx` and `packages/integrations/.../admin/EmailSettings.tsx` outbound selectors is noted for a follow-up card, not this one.
- Gmail flows: no behavior change. Copy edits only if a shared string forces it.
- No data-model/migration changes. The `microsoft_profiles` → `email_providers` → `tenant_email_settings` chain is already right; this is a presentation/gating/copy cleanup.
- No changes to OAuth scopes, callbacks' token exchange, or consent URL contents (recently fixed in b523f261be / b6f3a7eecc).

## Implementation phases

### Phase 1 — foundations: hosted-ness + consolidated readiness

1. **Hosted-deployment helper usable from `packages/integrations`.** `useTier().isHosted` lives in `server/src/context/TierContext.tsx` (fed by `isSelfHostLicensing()` in `server/src/app/msp/layout.tsx:70`); `packages/integrations` cannot import server context. Extract the underlying hosted/self-host determination into a shared server-side helper (shared lib or `packages/integrations/src/lib`) with a single source of truth, and make `TierContext` consume it so the two can never disagree. Client components in the package receive hosted-ness via action payloads (below), not via a new React context.
2. **Consolidated email readiness payload.** Extend/replace `getMicrosoftConsumerSetupStatus('email')` and `getMicrosoftEmailSetupOptions` so both surfaces render from one shape, e.g.:
   ```ts
   {
     state: 'not_configured' | 'pending_admin_consent' | 'ready',
     source: 'platform' | 'tenant_app' | null,
     hosted: boolean,               // deployment, for copy + option gating
     platformOffered: boolean,      // hosted && platform credentials present
     automatedCreationAvailable: boolean,
   }
   ```
   `pending_admin_consent` derives from the existing consent-tracking columns (`email_admin_consent_required` / `email_admin_consent_granted_at` on `microsoft_profiles`, migration `20260803000000`). The resolver work stays in `resolveMicrosoftConsumerProfileConfig` / `providerReadiness.ts` — this phase surfaces it once instead of piecemeal.
3. **Server-side redirect URI.** `initiateEmailOAuth` (`oauthActions.ts`) and `persistMicrosoftConfig` (`emailProviderActions.ts`) compute the redirect URI from the deployment's public base URL; stop accepting it from the client form. The manual-app wizard step displays the same computed value read-only.

### Phase 2 — Providers surface

Files: `packages/integrations/src/components/settings/integrations/MicrosoftEmailSetupDialog.tsx`, `MicrosoftIntegrationSettings.tsx`, `microsoftEmailSetupActions.ts`.

1. `getMicrosoftEmailSetupOptions` returns `platformOffered` per Phase 1; the dialog renders the platform card **only when `platformOffered`** — delete the disabled/"Unavailable" rendering path. Order: platform (hosted), automated, manual; "Recommended" badge on platform, "Advanced" on manual.
2. Consent step: "Microsoft 365 administrator" framing, approve action, copy-approval-link action (reuses `getMicrosoftEmailAdminConsentUrl`). Reconcile the diverged inline `defaultValue` vs locale string for `integrations.microsoft.emailSetup.platform.description`.
3. `MicrosoftIntegrationSettings`: finish the capability-based conversion started in 83ce26a80d — the edition-branched copy at ~L734-738 and ~L995-997 becomes capability/deployment-driven; the "Bring your own Microsoft app (advanced)" collapse and its copy ("normally unnecessary on hosted AlgaPSA") only claims hosted behavior when `hosted` is true. Ready-state hand-off keeps routing to `?category=communication` with "Connect a mailbox →" wording per the mockup.

### Phase 3 — Communication surface

Files: `packages/integrations/src/components/email/MicrosoftProviderForm.tsx`, `EmailProviderConfiguration.tsx`.

1. Strip `MicrosoftProviderForm` per the settled design: delete the platform-managed alert, the BYO expander + `useByoApp` state + init heuristic, the profile-ready notice, and the Redirect URI field (form no longer submits `redirect_uri`; it already submits empty credentials). Add the three-state status strip and rename the button to "Sign in with Microsoft". Providers links route to `?category=providers` (pattern already exists in `MicrosoftIntegrationSettings`).
2. `EmailProviderConfiguration`: replace the setup-instructions platform/BYO block (~L575-638) with the one-line pointer to Providers; keep loading the consolidated readiness payload once and passing it down.
3. The OAuth popup/postMessage flow (`initiateEmailOAuth` → `/api/auth/microsoft/callback`) is unchanged apart from server-derived redirect URI.

### Phase 4 — terminology sweep

1. Sweep user-facing strings in the files above plus `server/public/locales/en/msp/email-providers.json` and `server/public/locales/en/msp/integrations.json` (`integrations.microsoft.*` keys): no bare "tenant". Replacements per the cross-cutting rule. Known offenders inventoried: `MicrosoftProviderForm.tsx:577` ("tenant administrator"), `:512` ("tenant-owned"), `MicrosoftIntegrationSettings.tsx:802/822` ("tenant-owned"), `:1251` (bare "Tenant ID" label → "Microsoft tenant ID"), `EmailProviderConfiguration.tsx:603/618`, `MicrosoftEmailSetupDialog.tsx:287` ("Create an app in this tenant" → "…in your Microsoft organization"), locale keys `email-providers.json:53,58,276,282,283,322`.
2. Internal identifiers (`tenantId` vs `microsoftTenantId`) are renamed only where they cross a user-facing boundary in the touched files; no repo-wide identifier churn.

### Phase 5 — tests

1. **Update copy-coupled tests:** `packages/integrations/src/components/microsoftProviders.providersFirst.test.ts` (asserts exact BYO copy, `?category=providers` link, "Microsoft app profile is ready." — all changing), `server/src/test/unit/components/MicrosoftProviderForm.test.tsx`, `server/src/test/unit/components/EmailProviderConfiguration.test.tsx`, `MicrosoftIntegrationSettings.contract.test.tsx`.
2. **New gating tests:** hosted → platform option first + Recommended; self-hosted → platform option absent (not disabled); mailbox form three states (ready / pending consent / not configured) rendering and sign-in enablement; redirect URI absent from mailbox form payload and derived server-side.
3. **Regression guard:** a test asserting no user-facing string in the touched components matches bare-`tenant` patterns (word-boundary "tenant" not preceded by "Microsoft ", allowing "Microsoft tenant"), to keep the terminology rule from regressing.

## Acceptance criteria

- On a hosted deployment: Providers wizard lists platform first with "Recommended"; mailbox dialog shows only mailbox fields + status + sign-in; no Redirect URI input anywhere; no BYO expander in the mailbox dialog.
- On a self-hosted/appliance deployment (EE, no platform secrets): the platform option does not render anywhere; no "Platform Microsoft credentials are unavailable" error-shaped states in the default path; automated creation leads the wizard.
- With no profile configured, the mailbox dialog blocks sign-in and links to Providers; with consent pending, it blocks with the admin-approval message; with a ready profile, sign-in is enabled with no app-level chrome.
- `grep` over the touched components and locale namespaces finds no user-facing bare "tenant".
- All Phase 5 tests pass; `npm run lint` and the affected package builds pass.

## Notes for the implementing agent

- Follow `docs/AI_coding_standards.md` in this worktree.
- The three-surface chain and gating gap are recorded as card facts; the mockup HTML next to this plan is the visual contract — match its structure and copy tone, not necessarily pixel-for-pixel.
- Where the same platform/BYO explanation previously lived in three places, resist re-introducing per-surface variants: the readiness payload from Phase 1 is the single input, and each surface renders its own thin view of it.
