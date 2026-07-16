# PRD — Appliance trial product name

- Slug: `appliance-trial-product-name`
- Date: 2026-07-16
- Status: Approved mitigation

## Summary

Correct the self-hosted appliance trial banner so every banner state calls the paid product tier **Pro**. This supersedes the first-draft change in commit `46dfc7de84`, which changed the banner from Enterprise to Premium.

## Problem

The appliance trial banner originally called the appliance trial Enterprise. The first draft followed the runtime entitlement tier name and changed the copy to Premium, but the customer-facing top paid tier for this experience is Pro. Appliance operators therefore still see the wrong product name.

## Goals

- Use Pro in the appliance trial banner's active, expiring, available, expired, and CE-unused states.
- Keep translated banner strings aligned with the English product name.
- Prevent regressions to either Enterprise or Premium in focused banner coverage.

## Non-goals

- Rename the internal `premium` entitlement tier or alter licensing behavior.
- Rename the separate 30-day Premium subscription trial elsewhere in the product.
- Change the appliance license-management page, which was not changed by this card's first draft.
- Change banner layout, urgency, actions, or dismissal behavior.

## Users and Primary Flows

Self-hosted appliance administrators see the corrected name while a trial is active or expiring, before a trial is started, after it expires, and on an eligible CE install.

## UX / UI Notes

This is a copy-only correction. Existing translation keys, interpolation, pluralization, and component structure remain unchanged. Pro is a product name and remains `Pro` in each real locale. Pseudo-locales retain their opaque marker text.

## Requirements

### Functional Requirements

1. All appliance trial banner fallback copy introduced or changed by this card uses Pro.
2. All real-locale `licenseBanner` trial strings introduced or changed by this card use Pro.
3. Focused unit coverage exercises all appliance trial banner states and rejects both previous names.

### Non-functional Requirements

- Translation validation, the server typecheck, and the EE production build must continue to pass.
- Changes must remain limited to the banner, its localized strings, focused tests, and this plan.

## Data / API / Integrations

No data model or API changes. `LicenseStatus.tier` may remain `premium`; it represents an internal entitlement and does not determine the customer-facing copy in this banner.

## Security / Permissions

No changes.

## Observability

No changes.

## Rollout / Migration

No migration or feature flag is required. The corrected copy ships with the application bundle.

## Open Questions

None. The captain correction identifies Pro as the approved product name and limits the mitigation to appliance trial banner copy and related localized strings.

## Acceptance Criteria (Definition of Done)

- Active and expiring trial banners use Pro.
- Available, expired, and CE-unused trial banners use Pro.
- The corresponding real-locale `licenseBanner` values use Pro and contain neither Enterprise nor Premium.
- Focused unit tests and translation validation pass.
- Full server typecheck and EE production build pass.
