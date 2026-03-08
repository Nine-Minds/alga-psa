# Scratchpad — Microsoft Teams Integration V1

- Plan slug: `microsoft-teams-integration-v1`
- Created: `2026-03-07`

## What This Is

Keep a lightweight, continuously-updated log of discoveries and decisions made while implementing this plan.

Prefer short bullets. Append new entries as you learn things, and also *update earlier notes* when a decision changes or an open question is resolved.

## Decisions

- (2026-03-07) V1 scope is MSP users only; client-portal Teams experiences are out of scope.
- (2026-03-07) Teams will use the tenant-owned Microsoft provider configuration model rather than introducing a Teams-only credential store.
- (2026-03-07) Microsoft integration settings should expand from a singleton config into named Microsoft profiles.
- (2026-03-07) Teams will bind to one selected Microsoft profile at tenant admin setup time; end users do not choose a profile.
- (2026-03-07) Notification scope is simplified for v1: personal Teams activity-feed notifications only, no channel/chat routing.
- (2026-03-07) Bot scope is personal-first and command-first, not a general chatbot.
- (2026-03-07) Teams should be treated as one tenant integration with four surfaces, not four separate products.
- (2026-03-07) Shared command/action execution and shared notification payload generation should be reused across Teams surfaces to avoid duplicate implementations.
- (2026-03-07) Microsoft profile migration will be lazy and app-driven instead of a secret-provider-aware SQL migration: the first profile-aware read/write backfills a default profile from legacy tenant secrets and leaves legacy keys in place for compatibility.
- (2026-03-07) Default-profile compatibility will be maintained by mirroring the selected default profile back to legacy tenant secrets (`microsoft_client_id`, `microsoft_client_secret`, `microsoft_tenant_id`) until consumer-binding work lands.
- (2026-03-07) Profile secrets stay out of SQL. The database stores profile metadata plus a deterministic tenant secret reference (`microsoft_profile_<profile_id>_client_secret`).
- (2026-03-07) The Microsoft settings screen should become a profile manager in `Integrations -> Providers`, with one card per profile and shared app-registration guidance rendered inline instead of a separate Teams-only credential editor.
- (2026-03-07) Until explicit consumer-binding records ship, the UI will surface compatibility bindings by treating the active default profile as the current source for Email, Calendar, and MSP SSO.
- (2026-03-07) Teams registration guidance will be generated from deployment base URL plus profile client ID, including tab/bot/message-extension callback URLs and a derived Teams application ID URI (`api://<host>/teams/<clientId>`).
- (2026-03-07) The first Teams setup slice should live in `Integrations -> Providers` next to Microsoft profile management so admins can move between shared Microsoft credential setup and Teams setup without a separate navigation model.
- (2026-03-07) Until the tenant-scoped Teams integration record exists, the Teams settings UI should be a guided readiness card: list Microsoft profiles already ready for Teams and route tenants with no eligible profile back to Microsoft profile management.
- (2026-03-07) Consumer bindings should be lazy and tenant-scoped like Microsoft profile backfill: legacy Microsoft consumers (`email`, `calendar`, `msp_sso`) get compatibility binding rows on first binding-aware access, while `teams` remains explicit-only and never falls back silently.

## Discoveries / Constraints

- (2026-03-07) `packages/integrations/src/components/settings/integrations/MicrosoftIntegrationSettings.tsx` already anchors tenant-owned Microsoft config for Outlook inbound email, Outlook calendar, and MSP SSO; this is the right place to evolve toward named profiles.
- (2026-03-07) `packages/auth/src/lib/nextAuthOptions.ts` already uses Azure AD / Microsoft OAuth and can resolve tenant-specific Microsoft credentials through MSP SSO resolution.
- (2026-03-07) `packages/auth/src/lib/sso/mspSsoResolution.ts` already supports tenant-aware Microsoft provider discovery/resolution for MSP SSO.
- (2026-03-07) Existing in-app notifications already store `link` and metadata, and UI components open specific PSA tickets/tasks/documents from those links.
- (2026-03-07) Existing notification/deep-link infrastructure can be reused for Teams notification payloads instead of building a second record-linking system.
- (2026-03-07) Existing event/workflow infrastructure is a better trigger source for Teams notifications than adding a Teams-specific event bus.
- (2026-03-07) Existing extension iframe surfaces are useful precedent for embedded UI and auth forwarding, but they are not a native substitute for Teams bot/message-extension surfaces.
- (2026-03-07) Existing Microsoft integration flows for email, calendar, and Entra already establish tenant-secret and Graph API patterns that Teams can reuse.
- (2026-03-07) Existing Microsoft consumers still read the legacy tenant-secret keys directly. Introducing profiles without default-secret mirroring would break Outlook email, Outlook calendar, and MSP SSO compatibility.
- (2026-03-07) `packages/integrations/src/components/settings/integrations/IntegrationsSettingsPage.tsx` already gives the right long-term home for Microsoft profile management: `Integrations -> Providers`, not a new top-level settings tab.
- (2026-03-07) The backend compatibility guard is sufficient for `F015`/`T029-T030`: archiving the default profile is blocked until another profile is made default, which preserves the active compatibility binding.
- (2026-03-07) The second slice is complete: `F019-F035` and `T037-T070` pass with the profile manager UI, per-profile readiness/rendering, inline registration guidance, refresh, default switching, and archive confirmation.
- (2026-03-07) There was no existing Teams admin settings surface in the repo; `packages/integrations/src/components/settings/integrations/IntegrationsSettingsPage.tsx` `Providers` is the right mount point for the first Teams setup card.
- (2026-03-07) The shared `Button` component does not expose custom ids reliably in the jsdom contract harness, so the Teams settings contract test uses role/name queries for refresh actions.
- (2026-03-07) The third slice is complete: `F036`, `F048`, `F056`, `F057`, `F058` and `T071`, `T072`, `T095`, `T096`, `T111`, `T112`, `T113`, `T114`, `T115`, `T116` pass with a Providers-mounted Teams setup card, hash-based navigation between Microsoft profiles and Teams setup, and guided remediation when no eligible profile exists.
- (2026-03-07) `server/migrations/20260307143000_create_microsoft_profile_consumer_bindings.cjs` adds a tenant-scoped one-row-per-consumer binding table keyed by `(tenant, consumer_type)` with composite FK back to `microsoft_profiles`.
- (2026-03-07) `packages/integrations/src/actions/integrations/microsoftActions.ts` now exposes binding-aware helpers/actions: `listMicrosoftConsumerBindings`, `setMicrosoftConsumerBinding`, and `resolveMicrosoftProfileForConsumer`.
- (2026-03-07) The fourth slice is complete: `F037`, `F038`, `F039`, `F040`, `F041` and `T073`, `T074`, `T075`, `T076`, `T077`, `T078`, `T079`, `T080`, `T081`, `T082` pass with a real Microsoft consumer-binding model, lazy compatibility binding backfill for legacy Microsoft consumers, and Teams explicit-binding resolution.
- (2026-03-07) `server/migrations/20260307153000_create_teams_integrations.cjs` adds the tenant-scoped Teams integration table keyed by `tenant`, linked to a selected Microsoft profile, and storing install status, enabled capabilities, notification categories, and allowed quick actions.
- (2026-03-07) `packages/integrations/src/actions/integrations/teamsActions.ts` now exposes `getTeamsIntegrationStatus` and `saveTeamsIntegrationSettings` with tenant-admin gating, client-user rejection, explicit selected-profile validation, and readiness checks before activation.
- (2026-03-07) The fifth slice is complete: `F042`, `F043`, `F044`, `F045`, `F046`, `F047` and `T083`, `T084`, `T085`, `T086`, `T087`, `T088`, `T089`, `T090`, `T091`, `T092`, `T093`, `T094` pass with a real Teams integration record plus guarded admin save/load actions.
- (2026-03-07) `packages/integrations/src/components/settings/integrations/TeamsIntegrationSettings.tsx` now renders a real Teams setup form with explicit profile selection, readiness checklisting, selected-profile app-registration guidance, capability toggles, notification preferences, and activate/deactivate actions.
- (2026-03-07) The sixth slice is complete: `F049`, `F050`, `F051`, `F052`, `F053`, `F054`, `F055` and `T097`, `T098`, `T099`, `T100`, `T101`, `T102`, `T103`, `T104`, `T105`, `T106`, `T107`, `T108`, `T109`, `T110` pass with a saveable Teams setup workflow in the settings UI.

## Commands / Runbooks

- (2026-03-07) Scaffolded plan folder with: `python3 /Users/roberisaacs/.codex/skills/alga-plan/scripts/scaffold_plan.py "Microsoft Teams Integration V1" --slug microsoft-teams-integration-v1`
- (2026-03-07) Backend verification commands:
  - `cd server && npx vitest run --config vitest.config.ts ../packages/integrations/src/actions/integrations/microsoftActions.test.ts ../packages/integrations/src/actions/integrations/providerReadiness.test.ts`
  - `pnpm --dir packages/integrations typecheck`
- (2026-03-07) UI verification commands:
  - `cd server && npx vitest run --config vitest.config.ts ../packages/integrations/src/components/settings/integrations/MicrosoftIntegrationSettings.contract.test.tsx`
  - `cd server && npx vitest run --config vitest.config.ts ../packages/integrations/src/actions/integrations/microsoftActions.test.ts ../packages/integrations/src/actions/integrations/providerReadiness.test.ts ../packages/integrations/src/components/settings/integrations/MicrosoftIntegrationSettings.contract.test.tsx`
  - `cd server && npx vitest run --config vitest.config.ts ../packages/integrations/src/components/settings/integrations/TeamsIntegrationSettings.contract.test.tsx ../packages/integrations/src/components/settings/integrations/IntegrationsSettingsPage.providers.test.ts`
  - `cd server && npx vitest run --config vitest.config.ts ../packages/integrations/src/components/settings/integrations/MicrosoftIntegrationSettings.contract.test.tsx ../packages/integrations/src/components/settings/integrations/TeamsIntegrationSettings.contract.test.tsx ../packages/integrations/src/components/settings/integrations/IntegrationsSettingsPage.providers.test.ts`
  - `cd server && npx vitest run --config vitest.config.ts ../packages/integrations/src/actions/integrations/microsoftActions.test.ts ../packages/integrations/src/actions/integrations/microsoftConsumerBindings.test.ts ../server/src/test/unit/migrations/microsoftConsumerBindingsMigration.test.ts`
  - `cd server && npx vitest run --config vitest.config.ts ../packages/integrations/src/actions/integrations/teamsActions.test.ts ../server/src/test/unit/migrations/teamsIntegrationsMigration.test.ts`
  - `cd server && npx vitest run --config vitest.config.ts ../packages/integrations/src/components/settings/integrations/TeamsIntegrationSettings.contract.test.tsx ../packages/integrations/src/components/settings/integrations/IntegrationsSettingsPage.providers.test.ts`
- (2026-03-07) Relevant local references:
  - `packages/integrations/src/components/settings/integrations/MicrosoftIntegrationSettings.tsx`
  - `packages/integrations/src/components/settings/integrations/MicrosoftIntegrationSettings.contract.test.tsx`
  - `packages/integrations/src/components/settings/integrations/TeamsIntegrationSettings.tsx`
  - `packages/integrations/src/components/settings/integrations/TeamsIntegrationSettings.contract.test.tsx`
  - `packages/integrations/src/components/settings/integrations/IntegrationsSettingsPage.tsx`
  - `packages/integrations/src/components/settings/integrations/IntegrationsSettingsPage.providers.test.ts`
  - `packages/integrations/src/actions/integrations/microsoftActions.ts`
  - `packages/integrations/src/actions/integrations/microsoftConsumerBindings.test.ts`
  - `packages/integrations/src/actions/integrations/providerReadiness.ts`
  - `packages/integrations/src/actions/integrations/teamsActions.ts`
  - `packages/integrations/src/actions/integrations/teamsActions.test.ts`
  - `packages/auth/src/lib/nextAuthOptions.ts`
  - `packages/auth/src/lib/sso/mspSsoResolution.ts`
  - `packages/notifications/src/actions/internal-notification-actions/internalNotificationActions.ts`
  - `server/src/lib/utils/notificationLinkResolver.ts`
  - `server/src/lib/eventBus`
  - `server/migrations/20260307120000_create_microsoft_profiles.cjs`
  - `server/migrations/20260307143000_create_microsoft_profile_consumer_bindings.cjs`
  - `server/migrations/20260307153000_create_teams_integrations.cjs`
  - `server/src/test/unit/migrations/microsoftConsumerBindingsMigration.test.ts`
  - `server/src/test/unit/migrations/teamsIntegrationsMigration.test.ts`
- (2026-03-07) The focused vitest slice still emits pre-existing React `act(...)` warnings from `MicrosoftIntegrationSettings.contract.test.tsx`; the tests pass, but the harness remains noisy.
- (2026-03-07) The Teams setup contract tests currently emit similar non-blocking React `act(...)` warnings while asserting async save flows; the tests pass, but the harness remains noisy.
- (2026-03-07) Next unchecked feature after this slice is `F059` (Teams app manifest/package model).

## Links / References

- Microsoft Teams docs used during investigation:
  - Tabs overview: `https://learn.microsoft.com/en-us/microsoftteams/platform/tabs/what-are-tabs`
  - Tab SSO overview: `https://learn.microsoft.com/en-us/microsoftteams/platform/tabs/how-to/authentication/tab-sso-overview`
  - Tab SSO manifest: `https://learn.microsoft.com/en-us/microsoftteams/platform/tabs/how-to/authentication/tab-sso-manifest`
  - Bot SSO overview: `https://learn.microsoft.com/en-us/microsoftteams/platform/bots/how-to/authentication/bot-sso-overview`
  - Bot SSO manifest: `https://learn.microsoft.com/en-us/microsoftteams/platform/bots/how-to/authentication/bot-sso-manifest`
  - Activity feed notifications: `https://learn.microsoft.com/en-us/microsoftteams/platform/tabs/send-activity-feed-notification`
  - Deep links: `https://learn.microsoft.com/en-us/microsoftteams/platform/concepts/build-and-test/deep-links`
  - Search commands: `https://learn.microsoft.com/en-us/microsoftteams/platform/messaging-extensions/how-to/search-commands/define-search-command`
  - Action commands: `https://learn.microsoft.com/en-us/microsoftteams/platform/messaging-extensions/how-to/action-commands/define-action-command`
  - Dialogs / task modules: `https://learn.microsoft.com/en-us/microsoftteams/platform/task-modules-and-cards/task-modules/invoking-task-modules`
- Existing related plans:
  - `ee/docs/plans/2026-02-23-msp-tenant-first-sso-provider-resolution`
  - `ee/docs/plans/2026-02-20-entra-integration-phase-1`

## Open Questions

- Do existing Microsoft consumers beyond Teams need explicit per-consumer profile selection UX in v1, or is a default-binding compatibility path sufficient initially?
- How much approval behavior belongs in Teams quick actions versus deep-linking into the tab?
- What exact tenant-by-tenant Teams app packaging and distribution flow should be used across local/dev/staging/prod?
