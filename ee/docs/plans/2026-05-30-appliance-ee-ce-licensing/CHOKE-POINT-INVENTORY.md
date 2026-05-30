# Choke-Point Classified Inventory (F036)

Classification of every runtime edition check, per FR11. Two classes:

- **A — Module-presence guard**: decides whether to `import()`/select an `@enterprise`/`@ee`/backend
  module that may be absent in a CE build. **Left as build-time `isEnterprise`** — converting these
  would break imports on EE builds at the essentials tier (the module still exists).
- **B — Surface/feature-exposure gate**: decides whether a user SEES an EE page/route/component/
  affordance. **Converted to `eeEnabled`** (client: `useEeEnabled()` / `useTier().eeEnabled`;
  server component: `session.user.eeEnabled` / `serverEeEnabled`) so essentials falls through to the
  CE placeholders/404s.

## Class B — UI surface gates CONVERTED to eeEnabled (complete)

| File | What it gates |
|---|---|
| server/src/context/TierContext.tsx | `eeEnabled` source + tier from `effectiveTier` |
| server/src/components/settings/SettingsPage.tsx | EE settings tabs (extensions etc.) |
| server/src/components/settings/extensions/ExtensionManagement.tsx | Extensions manage/install UI |
| server/src/app/msp/settings/extensions/[id]/settings/page.tsx | Extension settings page → FeaturePlaceholder |
| server/src/components/layout/RightSidebar.tsx | EE AI right sidebar render |
| server/src/components/chat/QuickAskOverlay.tsx | EE Quick-Ask overlay render |
| server/src/components/dashboard/DashboardContainer.tsx | Welcome dashboard variant + onboarding |
| server/src/components/dashboard/AlgadeskDashboard.tsx | Welcome banner variant |
| server/src/app/msp/dashboard/page.tsx | DashboardOnboardingSlot (server component, session.eeEnabled) |
| server/src/components/settings/profile/UserProfile.tsx | Calendar profile tab |
| packages/integrations/.../IntegrationsSettingsPage.tsx | Visible integration categories |
| packages/integrations/.../MicrosoftIntegrationSettings.tsx | MS consumer surfaces (threaded into 2 helpers) |
| packages/integrations/.../CalendarEnterpriseIntegrationSettings.tsx | EE calendar settings render |
| packages/integrations/.../MspSsoLoginDomainsSettings.tsx | SSO login-domains EE UI |
| packages/integrations/.../TeamsEnterpriseIntegrationSettings.tsx | Teams settings availability |
| packages/integrations/.../RmmIntegrationsSetup.tsx | EE RMM provider options |
| packages/integrations/.../AccountingIntegrationsSetup.tsx | EE accounting (Xero) options |
| packages/integrations/.../email/EmailProviderSelector.tsx | EE email provider tiles |
| packages/integrations/.../email/EmailProviderConfiguration.tsx | EE email provider config |
| packages/clients/.../ClientDetails.tsx | Entra client-sync affordance |

Tier-gated (not edition-gated) UI also now respects essentials because `TierContext`/`ServerTierGate`
resolve tier from `session.user.effectiveTier` (so `hasFeature` returns false at essentials).

## Class A — Module-presence / backend guards LEFT build-time (correct)

Representative (not exhaustive — ~120 sites). These are NOT user-surface gates:
- `server/src/app/api/**/route.ts` CE-stub delegators that lazy-load `@enterprise` route impls.
- `server/src/lib/jobs/*` — Temporal-vs-pgboss runner selection.
- `packages/storage/src/StorageProviderFactory.ts` — storage backend selection.
- `packages/integrations/src/webhooks/stripe/*`, `packages/billing/.../paymentActions.ts` — hosted billing backends.
- `shared/services/email/...`, `packages/email/*` — EE email decider module load.
- Dynamic `import('@enterprise/...')`/`import('@ee/...')` at module scope (RightSidebar, QuickAskOverlay,
  ExtensionManagement `isEEBuild`, ExtensionSettings page) — the import target stays build-time; only the
  render decision is gated by eeEnabled.

## Server-side enforcement for edition-only EE features (F038 — RESOLVED)

EE features gated ONLY by edition (not by a `TIER_FEATURES` entry) are now enforced at the server layer
via `eeRuntimeEnabledServer()` in `packages/licensing` — `isEnterprise && self-host tier != essentials`,
falling back to `isEnterprise` on any DB error so hosted EE is never disabled. Applied to:

- `packages/integrations/src/actions/calendarActions.ts` — all 11 `isCalendarEnterpriseEdition()` guards
  now also require `await eeRuntimeEnabledServer()`.
- `packages/integrations/src/actions/integrations/microsoftActions.ts` — `getMicrosoftIntegrationStatus`
  resolves `eeRuntimeEnabledServer()` once and threads it into the consumer-visibility helpers.
- `server/src/app/api/chat/v1/{completions,completions/stream,execute}/route.ts` and
  `server/src/app/api/v1/ai/document-assist/route.ts` — edition gate now also requires
  `eeRuntimeEnabledServer()` (AI is additionally `AI_ASSISTANT` add-on gated).

At essentials these now return their CE response (placeholder/404/reduced consumer set). SaaS is
unchanged (no `license_state` row → `eeRuntimeEnabledServer()` returns true).

**Note on `@enterprise` platform routes** (extensions, platform notifications/reports, workflow studio):
these are gated by **tier-features** (`EXTENSIONS` etc.) / product-access / add-ons, not by edition. They
are essentials-aware through the now tier-aware `assertTierAccess` / `hasFeature` (`session.user.effectiveTier`),
so they are not part of the edition-only F038 set.
