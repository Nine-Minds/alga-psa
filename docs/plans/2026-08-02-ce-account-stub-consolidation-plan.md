# CE Account Stub Consolidation Implementation Plan

## Source and objective

This plan implements AlgaPSA ticket alga0002207 (ticket 04d719c4-86c1-4554-baad-dfaa395c92e9), confirmed through the AlgaPSA MCP ticket record and its internal Novity feedback comment.

In Community Edition, `server/src/app/msp/account/page.tsx` renders `@/empty/components/settings/account/AccountManagement`, whose current CE implementation returns `null`. The existing visible CE account placeholder lives at `packages/ee/src/app/msp/account/page.tsx`, so the current alias split leaves users with a heading and an empty body.

The outcome is one canonical CE-stub tree and a visible Account Management fallback in CE.

## Design decisions

1. Keep `packages/ee/src` as the canonical edition-substitution tree. It already contains the broad set of CE-facing substitutes used by build aliases and contains the intended Account Management placeholder.
2. Move the reusable account placeholder to the canonical component-shaped path expected by the consuming page: `packages/ee/src/components/settings/account/AccountManagement.tsx`.
3. Update the CE alias/configuration so `@/empty/*` resolves to the canonical `packages/ee/src/*` tree in CE builds.
4. Remove the duplicate `server/src/empty` files only after every current import/alias target has an equivalent canonical path. Do not silently discard a stub merely because it returns null; explicitly move or recreate each required compatibility target.
5. Preserve Enterprise Edition resolution and behavior. The consolidation must affect CE substitution only.
6. Keep this task focused on consolidation and Account Management visibility. A generalized upgrade-prompt component belongs to alga0002208 and should be consumed later rather than duplicated here.

## Implementation steps

### 1. Inventory edition aliases and consumers

- Locate all TypeScript, Next.js, webpack, Jest, and build-script mappings for `@/empty`.
- Enumerate every import that resolves into `server/src/empty`.
- Compare the 12 `server/src/empty` files against their counterparts, or intended destination paths, under `packages/ee/src`.
- Record any target that lacks a canonical counterpart before deleting anything.

### 2. Establish the canonical account component

- Create `packages/ee/src/components/settings/account/AccountManagement.tsx` from the existing visible placeholder in `packages/ee/src/app/msp/account/page.tsx`.
- Keep the component API compatible with the existing default import in `server/src/app/msp/account/page.tsx`.
- Avoid duplicating the page-level outer title/container already rendered by `server/src/app/msp/account/page.tsx`; the component should render the useful card/fallback content without nested duplicate page headings.
- Retain clear copy explaining that hosted Account Management and billing are Enterprise features while self-hosted CE is not license-restricted.

### 3. Consolidate the remaining CE stubs

- For each file under `server/src/empty`, move its behavior to the corresponding `packages/ee/src` path or add a compatibility module in the canonical tree.
- Update `@/empty` aliases and any direct `server/src/empty` references to point at the canonical tree.
- Delete `server/src/empty` only after repository-wide search shows no remaining configuration or import dependency on that directory.
- Do not modify unrelated generated/install state such as the pre-existing `package-lock.json` change.

### 4. Validate behavior and build resolution

- Run targeted type checking or the narrowest available build that exercises the server alias configuration.
- Run existing tests covering account/settings routing or CE build aliases, if present.
- Start or reuse the wired CE dev server and visit `/msp/account` as a CE tenant.
- Confirm the page renders visible fallback content, has no duplicate heading/container, and logs no module-resolution or hydration error.
- Confirm an EE build/import path still resolves to the real Account Management implementation.

## Behavioral acceptance criteria

- A CE user navigating to `/msp/account` sees a meaningful Account Management/upgrade explanation instead of an empty body.
- `server/src/app/msp/account/page.tsx` continues to consume a default `AccountManagement` component through the edition alias.
- There is only one maintained CE substitution tree for the affected stubs.
- Repository search finds no stale `server/src/empty` alias or import after consolidation.
- CE type/build checks pass, and the wired page renders without runtime errors.
- EE Account Management behavior is unchanged.

## Verification notes for later lane steps

Draft Implementation should include the exact alias/config files changed and the final mapping of all 12 former `server/src/empty` targets in its handoff. Smoke Test should capture a CE `/msp/account` rendering and a repository-wide stale-path search as evidence.

