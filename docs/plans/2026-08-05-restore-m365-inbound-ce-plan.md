# Restore Microsoft 365 inbound email to Community Edition

## Intent

Remove the UI-only edition gate that inadvertently hid Microsoft 365 inbound email from Community Edition while preserving the deliberate Pro boundaries around calendar, Teams, and hosted/platform credentials.

## Code findings

The current branch is clean at `860071a686`. Direct inspection confirmed the gate remains in `EmailProviderSelector.tsx` (`isEnterpriseEdition`, conditional Microsoft card, `UpgradePrompt`, conditional help copy) and in `EmailProviderConfiguration.tsx` (edition-only loader behavior, edit rejection, Microsoft filtering, conditional header/count copy, conditional provider UI). The backend is not part of this gate.

## Implementation

1. Make `EmailProviderSelector.tsx` edition-neutral: remove the edition helper and upgrade prompt imports/state, render the Microsoft card unconditionally, retain the three-column layout, and use one provider-neutral help string.
2. Make `EmailProviderConfiguration.tsx` edition-neutral for inbound providers: always load Microsoft configuration support, allow editing Microsoft providers, include them in `visibleProviders`, and remove edition-conditioned header/count/add-provider rendering and feedback.
3. Remove only translation keys made unreachable by this change, after searching all locales/usages; do not disturb shared Microsoft integration copy.
4. Update behavioral component tests so CE renders/selects Microsoft, lists existing Microsoft providers, and opens the edit path. Keep an EE assertion to prove behavior remains unchanged.
5. Run the focused integration component tests plus package typecheck/build. Smoke in a CE runtime with `EDITION=ce` and `NEXT_PUBLIC_EDITION=community`: create, list, and edit a bring-your-own-app Microsoft provider.

## Deliberate non-goals

- Do not change `microsoftConsumerVisibility.ts`: email remains CE-visible; calendar and Teams remain Pro-only.
- Do not unlock platform/hosted Microsoft credentials in `MicrosoftIntegrationSettings.tsx`.
- Do not remove `assertTenantProductAccess(email_to_ticket)` or alter backend Graph/webhook behavior.

## Risks

The main risk is accidentally broadening Microsoft integration access beyond inbound email. Tests must exercise the email provider components in CE and retain visibility-contract coverage for calendar, Teams, and platform credentials.
