# Scratchpad — Dashboard Onboarding Checklist: Sub-steps + Updated Portal/Email Items

- Plan slug: `2026-01-07-dashboard-onboarding-checklist-substeps`
- Created: `2026-01-07`

## What This Is

Rolling notes for discoveries/decisions while implementing sub-steps in the dashboard onboarding checklist.

## Decisions

- (2026-01-07) Keep existing top-level step IDs (`client_portal_domain`, `managed_email`) for analytics/back-compat; update only titles/copy and add sub-steps under them.
- (2026-01-07) Sub-step completion rules: portal branding = any portal configuration exists; invite contact = portal invite exists; inbound email = any `email_providers` row exists.

## Discoveries / Constraints

- (2026-01-07) Current onboarding pipeline: `server/src/lib/actions/onboarding-progress.ts` → `useOnboardingProgress` → dashboard quick-start + `OnboardingChecklist`.
- (2026-01-07) Current SSO CTA href is `/msp/account/sso`; requested correct route is `/msp/profile?tab=Single+Sign-On`.

## Commands / Runbooks

- `rg -n "useOnboardingProgress|OnboardingChecklist|getOnboardingProgressAction" server/src -S`

## Links / References

- Existing checklist plan: `ee/docs/plans/2025-11-17-onboarding-dashboard-checklist-plan.md`
- Signal documentation: `docs/getting-started/configuration_guide.md`
- Implementation files:
  - `server/src/lib/actions/onboarding-progress.ts`
  - `server/src/components/dashboard/hooks/useOnboardingProgress.tsx`
  - `server/src/components/dashboard/OnboardingChecklist.tsx`
  - `server/src/components/dashboard/Dashboard.tsx`

## Open Questions

- (Resolved 2026-01-07) Completion criteria confirmed for portal branding customization, invite first contact to portal, and inbound email configuration.
