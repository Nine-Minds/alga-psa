# Scratchpad — AlgaDesk Onboarding Wizard

## Decisions

- AlgaDesk onboarding should not create PSA-only billing/service/contract setup data.
- A future AlgaDesk-to-PSA upgrade should run a separate PSA initializer when the product changes to `psa`.
- Use the existing `/msp/onboarding` route and shared wizard, made product-aware.
- Keep help-desk-relevant optional setup in AlgaDesk; remove Billing.

## Discoveries

- `server/src/app/msp/layout.tsx` already resolves `productCode` and wraps MSP pages in `MspLayoutClient`.
- `MspLayoutClient` wraps onboarding children in `AppSessionProvider` and `ProductProvider`, so the client onboarding page can read product context.
- `packages/onboarding/src/components/OnboardingWizard.tsx` currently uses numeric step indexes directly for rendering, validation, and server action dispatch.
- Billing setup is only invoked from step index 4 in `saveStepData`.
- Ticketing defaults are handled through `configureTicketing` and `validateOnboardingDefaults` on step index 5.
- AlgaDesk dashboard currently returns `AlgaDeskDashboard` directly and does not render the PSA dashboard onboarding checklist slot.

## Implementation Notes

- Introduce product-aware active step index helpers in `OnboardingWizard.tsx`.
- Keep `currentStep` and `completedSteps` as displayed positions, then map to original indexes for action/render/validation logic.
- Add focused tests under `server/src/test/unit/onboarding`.

## Validation

- `cd server && npx vitest run src/test/unit/onboarding/algadeskOnboardingWizard.productSteps.test.ts src/test/unit/onboarding/onboardingWizardDataSeparation.test.tsx src/test/unit/onboarding/clientInfoStepRendering.test.tsx`
- `cd server && npm run typecheck`

## Implementation Summary

- Added `packages/onboarding/src/lib/onboardingWizardSteps.ts` for product-specific wizard step derivation.
- Wired `server/src/app/msp/onboarding/page.tsx` to read `productCode` from `ProductProvider` and pass it to `OnboardingWizard`.
- Updated `OnboardingWizard` to keep displayed step positions separate from original server-action step indexes.
- AlgaDesk active steps are Client Info/Workspace, Team Members, Add Client, Client Contact, and Ticketing. Billing remains PSA-only.
- Added source/contract and helper tests for product-specific behavior.
- Updated existing ClientInfoStep tests to mock `useI18n` and tolerate locale seeding updates while preserving tenantName/clientName separation assertions.

## Review Follow-up

- Ran builtin reviewer on the uncommitted diff.
- Added AlgaDesk onboarding translation keys to all `server/public/locales/*/msp/onboarding.json` files.
- Restored the stricter tenantName/clientName test assertion by clearing the locale-seeding update before typing.
- Aligned `handleSkip` with displayed required step positions.
- Added locale-key coverage to the AlgaDesk onboarding contract test.
