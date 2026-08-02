# Teams add-on paywall destination plan

Date: 2026-08-02  
Card: alga0002212

## Problem

Teams paywall CTAs hard-code `/msp/account`, where the add-on section is collapsed, lacks a stable target, and renders no useful destination in CE. Users reach a dead end instead of a focused purchase or upgrade path.

## Design

1. Define a canonical internal destination `/msp/add-ons?addon=teams` and replace duplicated Teams CTA constants with a shared route helper.
2. In hosted EE, route that destination into Account Management with the Teams add-on section selected, expanded, focused, and assigned a stable accessible heading/anchor. Preserve direct `/msp/account` behavior.
3. In CE, resolve the same destination to the shared edition upgrade prompt rather than rendering the EE account surface or a blank page.
4. Preserve query state across authentication redirects and client navigation so the intended add-on remains selected.
5. Keep purchase URLs and external commerce actions behind the existing account/add-on boundary; this change only fixes internal navigation.

## Behavioral tests

- Both Teams CTA components use the canonical destination.
- Hosted EE opens Account Management with Teams expanded and focused.
- CE displays the shared upgrade prompt and never renders a blank destination.
- Unknown add-on keys fall back safely to the normal add-ons/account view.
- Direct account navigation, permissions, keyboard focus, and back navigation remain stable.

## Acceptance criteria

- Every Teams paywall CTA lands on an actionable, visible Teams destination.
- Hosted EE and CE use edition-appropriate outcomes.
- The add-on selection is deep-linkable and accessible.
- No new external purchase action is introduced.

## Evidence inspected

- Card context, both Teams CTA components, Account routing/layout, EE add-on controls, CE/EE alias patterns, shared upgrade notice, and relevant tests.

## Risks

- Route rewrites can loop or lose query state; cover authenticated and unauthenticated entry.
- Coupling to the shared upgrade component depends on alga0002208; use its stable public seam or a temporary adapter without duplicating copy.
