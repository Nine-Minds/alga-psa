# Scratchpad — Appliance trial product name

- Plan slug: `appliance-trial-product-name`
- Created: 2026-07-16

## Decisions

- 2026-07-16: Follow the captain correction and use Pro in this card's appliance trial banner copy. Do not derive the label from the internal `premium` tier.
- 2026-07-16: Keep the correction scoped to `LicenseBanner`, its `common.json` strings, and its focused test. Other Premium subscription trials are distinct products and remain unchanged.

## Discoveries / Constraints

- 2026-07-16: `git log main..HEAD --name-only -- docs/plans/` returned no task-specific design-session plan before implementation.
- 2026-07-16: Commit `46dfc7de84` is the existing first draft. It changed the banner from Enterprise to Premium, added `trialAvailable`/`trialExpired` locale keys, and added focused unit coverage.
- 2026-07-16: Worktree changes to `.npmrc` and `package-lock.json` predate this mitigation and must remain uncommitted.
- 2026-07-16: The internal trial entitlement remains `tier: 'premium'`; only the customer-facing product name is Pro.
- 2026-07-16: All eight real-locale `licenseBanner` trial groups now use Pro. The `xx` and `yy` pseudo-locales remain marker-only and required no product-name edit.

## Commands / Runbooks

- Focused test: `cd server && npx vitest run src/test/unit/components/licenses/LicenseBanner.test.tsx`
- Translation validation: `node scripts/validate-translations.cjs`
- Full typecheck: `node --max-old-space-size=16384 node_modules/typescript/bin/tsc --noEmit -p server/tsconfig.json`
- EE production build: `cd server && EDITION=ee NEXT_PUBLIC_EDITION=enterprise NODE_ENV=production node --max-old-space-size=16384 ../node_modules/next/dist/bin/next build --webpack`. Run Next directly because the worktree `.npmrc` preload overrides `NODE_OPTIONS` in npm scripts.

## Links / References

- `server/src/components/licenses/LicenseBanner.tsx`
- `server/src/test/unit/components/licenses/LicenseBanner.test.tsx`
- `server/public/locales/{de,en,es,fr,it,nl,pl,pt,xx,yy}/common.json`

## Open Questions

- None.

## Results

- 2026-07-16: Focused `LicenseBanner` unit suite passed: 5 tests, including the previously implicit CE-unused state.
- 2026-07-16: `node scripts/validate-translations.cjs` passed for all real and pseudo-locales with 0 errors and 0 warnings.
- 2026-07-16: An explicit scan of every real-locale `licenseBanner` trial value found Pro and no Enterprise/Premium remnants.
- 2026-07-16: Full server typecheck passed using direct TypeScript invocation with a 16 GB heap.
- 2026-07-16: Direct EE Next.js webpack production build passed with a 16 GB heap. It emitted existing webpack warnings and the known `/_global-error` dynamic-server note, then exited 0.
