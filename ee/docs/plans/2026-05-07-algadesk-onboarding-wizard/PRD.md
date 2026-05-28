# PRD — AlgaDesk Onboarding Wizard

- Slug: `algadesk-onboarding-wizard`
- Date: `2026-05-07`
- Status: Draft

## Summary

Make the existing onboarding wizard product-aware so AlgaDesk tenants get a focused help-desk setup flow while PSA tenants retain the current full PSA onboarding flow. AlgaDesk onboarding must initialize the data needed for a working ticketing environment without creating PSA-only billing/service/contract setup data.

## Problem

AlgaDesk is a lightweight help-desk product variant. The current wizard is PSA-oriented and includes steps such as Billing that are not available in AlgaDesk. Sending AlgaDesk tenants through PSA setup creates confusing UX and risks initializing data for disabled surfaces. At the same time, AlgaDesk still needs a complete operational baseline: tenant/admin details, optional team and client/contact data, and ticketing defaults such as boards, statuses, priorities, and ticket numbering.

## Goals

1. Detect the tenant product and render an AlgaDesk-specific wizard for `product_code = algadesk`.
2. Preserve the current 6-step PSA wizard unchanged for `product_code = psa`.
3. Remove PSA-only setup steps from AlgaDesk onboarding, especially Billing.
4. Keep help-desk-relevant setup available for AlgaDesk: workspace/admin info, team members, first client, client contact, and ticketing configuration.
5. Ensure AlgaDesk onboarding completion still validates ticketing defaults needed for a functional help desk.
6. Avoid initializing PSA-only billing/service/contract data during AlgaDesk onboarding.
7. Keep a future PSA upgrade path clean by leaving PSA default initialization to a separate upgrade initializer when a tenant upgrades.

## Non-goals

1. Building a separate onboarding route or deployment for AlgaDesk.
2. Changing tenant creation or `product_code` assignment flows.
3. Creating PSA billing/service/contract defaults for AlgaDesk tenants.
4. Implementing the future AlgaDesk-to-PSA upgrade initializer in this work.
5. Redesigning the ticketing configuration step.
6. Adding the PSA dashboard onboarding checklist to AlgaDesk dashboards.

## Users and Primary Flows

- AlgaDesk admin:
  - signs into a new AlgaDesk tenant,
  - is redirected to `/msp/onboarding`,
  - sees AlgaDesk-branded help-desk setup without Billing,
  - configures a ticket board/status/priority baseline,
  - completes onboarding and lands in the AlgaDesk dashboard.
- PSA admin:
  - experiences the existing onboarding flow with no product-specific regression.
- Future upgrade operator:
  - can upgrade an AlgaDesk tenant later without reverse-engineering hidden billing defaults created during help-desk onboarding.

## UX / UI Notes

- Use the same `/msp/onboarding` route and existing wizard shell.
- AlgaDesk copy should refer to setting up AlgaDesk/help desk rather than a full PSA system.
- AlgaDesk step list should hide Billing and keep only help-desk-relevant setup.
- Optional steps remain skippable; required steps remain workspace/admin info and ticketing.
- The ticketing step remains the source of board/status/priority setup for both products.

## Data / API / Integration Notes

- Product detection comes from the existing product seam (`session.user.product_code` surfaced through `ProductProvider`).
- The wizard should receive a product code and derive its active step list from that product.
- Existing server actions remain shared, but AlgaDesk navigation must not call `setupBilling` because the Billing step is not reachable.
- Existing onboarding progress storage rules remain: do not persist user-specific fields in tenant-wide `onboarding_data`.
- Completion still calls `completeOnboarding()` after ticketing validation/configuration.

## Risks and Constraints

- The current wizard uses numeric step indexes. Product filtering must distinguish display step positions from the original action indexes to avoid accidentally calling the wrong server action.
- Tests should protect PSA step preservation and AlgaDesk Billing removal.
- Existing partial `onboarding_data` from PSA or earlier flows may contain billing fields; AlgaDesk should ignore those in navigation rather than deleting them unexpectedly.

## Acceptance Criteria / Definition of Done

1. PSA tenants still see all current wizard steps, including Billing.
2. AlgaDesk tenants do not see the Billing step and cannot trigger `setupBilling` from wizard navigation.
3. AlgaDesk tenants can complete onboarding after required workspace/admin and ticketing setup.
4. AlgaDesk optional help-desk setup steps remain available/skippable.
5. AlgaDesk onboarding shell uses AlgaDesk/help-desk-oriented title/description copy.
6. Existing tenant-wide onboarding data separation for user fields remains intact.
7. Automated tests cover product-specific step derivation and route/page wiring where practical.
