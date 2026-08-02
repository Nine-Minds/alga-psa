# Edition-aware CE navigation plan

Date: 2026-08-02  
Card: alga0002209

## Problem

Community Edition currently treats every feature and add-on as enabled in `TierContext`, so enterprise-only sidebar entries remain visible and can lead to blank pages. Navigation must be edition-aware without changing the broader feature semantics used elsewhere.

## Design

1. Add explicit edition availability metadata to menu entries in `server/src/config/menuConfig.ts`; default entries remain available in both editions and enterprise-only entries opt into EE-only visibility.
2. Update `SidebarWithFeatureFlags.tsx` to recursively filter sections and children by edition before applying existing feature/add-on checks. Remove empty groups and preserve ordering, permissions, active-route behavior, and mobile/desktop parity.
3. Read edition through the established product/edition context rather than hostname or deployment heuristics.
4. Hide EE-only entries in CE for this change. Do not globally change CE `hasFeature()` or `hasAddOn()` behavior because those APIs have consumers beyond navigation.
5. Keep the shared CE upgrade prompt integration separable so alga0002208 can later supply a stable badge/deep-link treatment without coupling this fix to unfinished work.

## Behavioral tests

- CE hides representative EE-only leaf entries and recursively removes an empty parent group.
- EE retains the same entries and ordering.
- CE-visible entries still obey permissions and existing feature/add-on rules.
- Mixed groups retain their CE-visible children.
- Active-route and responsive sidebar behavior remain unchanged.

## Acceptance criteria

- CE users cannot navigate from the sidebar into known EE-only blank pages.
- EE navigation is unchanged.
- Edition metadata is explicit and reviewable in menu configuration.
- No global change to `TierContext` feature/add-on semantics is required.

## Evidence inspected

- Card description and trail for alga0002209.
- `TierContext.tsx`, `SidebarWithFeatureFlags.tsx`, `menuConfig.ts`, and `tierFeatures.ts`.
- Existing `TierContext.test.tsx` and `SidebarWithFeatureFlags.productShell.test.tsx` coverage.

## Risks

- Incorrect metadata could hide valid CE navigation; cover representative sections and audit every gated entry.
- Recursive filtering can leave empty containers; test nested and mixed groups explicitly.
- Future upgrade badges must use the shared alga0002208 component rather than duplicating paywall copy.
