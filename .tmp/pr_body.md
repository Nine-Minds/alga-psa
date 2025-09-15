This PR migrates the branch toward a Next.js-first architecture and consolidates product packages onto TypeScript entrypoints, alongside related server and app updates.

Highlights
- Refactor: replace `index.js` with `index.ts` across product packages; convert entry files to `ts/tsx` and update package exports
- EE/CE: add packages and unify single-project structure in `ee/server`
- Next.js: update configs in `ee/server` and `server`; add shims and external module type declarations
- Middleware: make edge middleware safe and decouple NextAuth
- Server: add `instrumentation.ts`; adjust streaming API routes and initialization
- Extensions: add extensions and workflows pages/entries for both EE and OSS
- Build: improve turbopack usability; fix console errors and dependencies (e.g., sharp)
- UI: calendar consistency improvements and related fixes
- Chore: remove legacy Express usage in favor of Next.js routing

Commit Summary (branch-only)
- be60247c refactor: migrate product packages to TypeScript entrypoints
- 186bc65d feature(ee/server): adding packages and single project structure for ee/ce
- 5e817c84 feat(ee/server): add instrumentation.ts and fix sharp dependencies
- a580161c feat(edge): make middleware Edge-safe and decouple NextAuth
- fae80a3b dates broke it a little, here comes the fix
- 73bdbef4 consistent calendar all across alga
- c7a113fb yay for better calendar!
- ae7d81ba it's fast and it builds!
- fb1d3f4d several steps closer to sucessful build
- 47ca0f3a some changes for calendar, but colors are not what they need to be yet...
- 08a47d2d it is hot, but not even ready
- 02974580 somewhat usable turbopack
- f4062c03 fixing console errors
- 0e8dd285 15 incoming!
- af0db8a4 some fixes for middleware
- 3f199a17 get rid of express

Notes
- This includes breaking changes for consumers expecting `index.js` entrypoints; ensure downstream imports reference the new `index.ts` exports.
- Force-pushed after squashing three WIP commits into a single refactor commit.
