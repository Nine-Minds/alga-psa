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

## KNOWN GAP — server-side enforcement for edition-only EE features (follow-up, see F038)

EE features that are gated ONLY by edition (not by a `TIER_FEATURES` entry, so not covered by the
tier-aware `assertTierAccess`) still pass their **server-action / API-route** edition checks at the
essentials tier, because those checks read build-time `isEnterprise`/edition:

- `packages/integrations/src/actions/calendarActions.ts` (~12 `if (!isCalendarEnterpriseEdition())` guards)
- `packages/integrations/src/actions/integrations/microsoftActions.ts` (MS consumer guards)
- `server/src/app/api/chat/v1/*`, `server/src/app/api/v1/ai/*` (AI endpoints — also add-on gated, so
  effectively blocked at essentials by the absent `AI_ASSISTANT` add-on)

**Impact:** the UI for these is hidden at essentials (Class B above), but a direct server-action/API
call would still execute. For a single-tenant self-hosted appliance this is a soft boundary, consistent
with the v1 trust model. **Recommended follow-up (F038):** add a server-side `eeEnabled` resolution
(via `getLicenseStateRow()`/session) to these edition-only feature gates so essentials is enforced at the
server layer too. Not implemented in this pass.
