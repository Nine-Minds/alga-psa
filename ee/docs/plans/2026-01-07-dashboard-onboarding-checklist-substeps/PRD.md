# PRD — Dashboard Onboarding Checklist: Sub-steps + Updated Portal/Email Items

- Slug: `2026-01-07-dashboard-onboarding-checklist-substeps`
- Date: `2026-01-07`
- Status: Draft

## Summary

Update the MSP dashboard onboarding checklist to support sub-steps within a step card. Two existing steps will be re-framed (Customer Portal setup and Email configuration) to show multiple sub-items that must all be completed before the parent step is considered complete. Also fix the Secure Identity & SSO “Connect SSO” link.

## Problem

Today, each onboarding step is treated as a single boolean-ish completion state. Some setup areas require multiple distinct actions (e.g., portal domain + portal branding + inviting a portal user). Without sub-steps, the checklist can report “complete” too early or lacks guidance for what’s still missing, reducing its usefulness.

## Goals

- Support rendering and tracking sub-steps inside a checklist step card.
- Consider a step complete **only when all of its sub-steps are complete**.
- Update checklist content:
  - Replace “Client Portal Domain” with a broader “Set Up Customer Portal” step that includes:
    - Portal custom domain
    - Portal color and logo customizations
    - Invite your first contact to the portal
  - Replace “Managed Email Domain” with “Configure Email” that includes:
    - Configure inbound email
    - Configure outbound custom email domain
- Fix the Secure Identity & SSO “Connect SSO” link to `/msp/profile?tab=Single+Sign-On`.

## Non-goals

- Adding new backend configuration workflows beyond surfacing existing state.
- Changing the overall number of top-level onboarding panels (keep the existing set of top-level steps stable unless required for UX).
- Adding new analytics/metrics beyond what already exists for step completion and CTA clicks (unless requested).

## Users and Primary Flows

- **MSP admin** opens the dashboard and sees onboarding cards and/or the onboarding drawer.
- Admin clicks CTAs to complete setup tasks.
- Progress updates automatically as configuration is completed, with sub-step checkmarks reflecting what’s done and what remains.

## UX / UI Notes

- Sub-steps should be displayed within the relevant onboarding step card as a short list with completion checkmarks.
- Parent step status rules:
  - **complete**: all sub-steps complete
  - **blocked**: any sub-step blocked (surface the most relevant blocker message)
  - **in_progress**: at least one sub-step started/complete but not all complete
  - **not_started**: all sub-steps not started
- If a step has no sub-steps, behavior remains unchanged.
- Parent “progressValue” may be derived from sub-steps (e.g., 1/3, 2/3 → 33%, 67%) to keep existing progress visuals meaningful.

## Requirements

### Functional Requirements

1. The onboarding progress payload supports an optional list of sub-steps per step.
2. The dashboard checklist UI renders sub-steps with a checked/unchecked affordance.
3. The parent step status is derived from its sub-steps (or legacy single-step status when no sub-steps exist).
4. “Set Up Customer Portal” sub-steps resolve from existing system signals:
   - Portal custom domain: reuse current portal domain status signal.
   - Portal color/logo customization: infer from tenant branding settings.
   - Invite first contact: infer from portal invitation / client portal user existence.
5. “Configure Email” sub-steps resolve from existing system signals:
   - Inbound email: infer from inbound email provider configuration.
   - Outbound custom email domain: reuse managed email domain verification status.
6. The Secure Identity & SSO card CTA route is corrected to `/msp/profile?tab=Single+Sign-On`.

### Non-functional Requirements

- Keep the implementation lightweight and consistent with the existing `getOnboardingProgressAction` aggregation pattern.
- Ensure the UI gracefully handles missing `substeps` (backward-compatible rendering).

## Data / API / Integrations

- Extend `OnboardingStepServerState` to include `substeps?: OnboardingSubstepServerState[]`.
- Add/extend a small helper to derive parent step status + progress from sub-steps.
- Reuse existing actions/services where possible:
  - Portal domain: `getPortalDomainStatusAction`
  - Tenant branding: `tenant_settings.settings.branding` (via an existing action or direct query)
  - Portal invite/user: query `portal_invitations` and/or `users` (`user_type = 'client'`)
  - Inbound email: query `email_providers` (and/or vendor configs as needed)
  - Outbound domain: `@ee/lib/actions/email-actions/managedDomainActions.ts`

## Security / Permissions

- No new permissions surfaces; onboarding progress continues to require an authenticated MSP session.
- Data derived should not leak sensitive secret material; only counts/statuses and non-sensitive metadata are included.

## Observability

- Keep existing `onboarding_step_completed` event semantics (fires when the parent step transitions to `complete`).
- (Optional) Decide whether to add sub-step completion events later; not required for this scope.

## Rollout / Migration

- No data migrations expected.
- Roll out as a UI + server aggregation update; ensure older clients tolerate missing `substeps` and newer clients tolerate empty lists.

## Open Questions

Resolved (2026-01-07):

1. “Portal color and logo customizations” is complete when **any** customer portal configuration exists (any configuration at all).
2. “Invite your first contact to the portal” is complete when **a portal invite exists**.
3. “Configure inbound email” is complete when **any provider row exists**.

## Acceptance Criteria (Definition of Done)

- The onboarding checklist shows sub-steps for the Customer Portal and Email cards.
- Each sub-step has an accurate checked/unchecked state based on system signals.
- Parent card only shows “Complete” when all of its sub-steps are complete.
- The Secure Identity & SSO CTA navigates to `/msp/profile?tab=Single+Sign-On`.
- Existing steps without sub-steps behave exactly as they do today.
