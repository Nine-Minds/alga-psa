# Scratchpad — Cross-Package Import Violation Cleanup

- Plan slug: `cross-package-cleanup`
- Created: `2026-02-16`
- Branch: `phase3-cross-package-cleanup` (fresh from main)

## Decisions

- (2026-02-16) Fresh branch from main instead of continuing stale `phase3-cross-package-violations-v2`. The old branch cherry-picked from an even older branch and whitelisted 76 violations instead of moving code.
- (2026-02-16) Only 2 ALLOWED_PAIRS: `integrations->clients` (4) and `integrations->scheduling` (1). These are pure data-access dependencies with no clean move target. All other violations resolved by actual moves.
- (2026-02-16) `documents` reclassified as L2 infrastructure (like `media`, `core`, `db`). It's used by 6+ vertical packages for shared document storage/components — not a vertical domain.
- (2026-02-16) `client-portal` exempted from VERTICAL_PACKAGES — it's a composition layer like `msp-composition`.

## Discoveries / Constraints

- (2026-02-16) Baseline on main: **161 violations** across packages/ (lint command on main doesn't include packages/, so these are invisible).
- (2026-02-16) After removing client-portal (39) and documents (38) from VERTICAL_PACKAGES: **~84 violations** remaining.
- (2026-02-16) Pre-existing bugs in `blocknoteUtils.ts` (in documents package):
  - Broken HTML escaping in codeBlock: `.replace(/&/g, '&')` is a no-op (should be `'&amp;'`)
  - Same in default case handler
  - Unsanitized `language` prop in `<code class="language-${language}">` — attribute injection risk
- (2026-02-16) `getEntityImageUrlsBatch` in media/avatarUtils makes sequential `await` calls — should use `Promise.allSettled` for batch.
- (2026-02-16) `msp-composition` already exists with `tickets/`, `projects/`, `scheduling/` sub-modules. Good starting point for Stage 8 moves.

## Commands / Runbooks

- Count violations: `npx eslint "packages/**/*.{ts,tsx}" 2>&1 | grep "no-feature-to-feature" | wc -l`
- Violations by pair: `npx eslint "packages/**/*.{ts,tsx}" 2>&1 | grep "no-feature-to-feature" | sed 's/.*Feature package "\([^"]*\)" must not import feature package "\([^"]*\)".*/\1 -> \2/' | sort | uniq -c | sort -rn`
- Build: `npm run build`
- Tests: `npx vitest run`

## Links / References

- Old plan: `.ai/stale_code_cleanup_plan.md`
- ESLint rule: `eslint-plugin-custom-rules/no-feature-to-feature-imports.js`
- Old branch: `phase3-cross-package-violations-v2` (2 commits, not merged)
- msp-composition package: `packages/msp-composition/`

## Open Questions

- Stage 8 sizing: should each sub-stage (8a-8d) be a separate commit, or is one commit OK?

- (2026-02-16) Stage 1: Expanded npm run lint to include packages/ in root package.json.

- (2026-02-16) Stage 1 test: ran `npm run lint`; lint now covers packages/ and reports existing violations (expected).

- (2026-02-16) Stage 2: Removed client-portal from VERTICAL_PACKAGES with composition-layer rationale comment.

- (2026-02-16) Stage 2 test: `npx eslint packages` shows no client-portal feature-to-feature violations.

- (2026-02-16) Stage 2: Removed documents from VERTICAL_PACKAGES with shared-infrastructure rationale comment.

- (2026-02-16) Stage 2 build: `npm run build` failed (Next.js build OOM in node) after assemblyscript step; need rerun with more memory later.

- (2026-02-16) Stage 3: Copied blocknoteUtils to core, added export map entry and @blocknote/core dependency.

- (2026-02-16) Stage 3: Fixed codeBlock HTML escaping in core blocknoteUtils (escapeHtml for code content).

- (2026-02-16) Stage 3 test: added core blocknoteUtils vitest for codeBlock escaping; `npx vitest run packages/core/src/lib/blocknoteUtils.test.ts` passes.

- (2026-02-16) Stage 3: Fixed default-case HTML escaping in core blocknoteUtils (escapeHtml for string content).

- (2026-02-16) Stage 3 test: extended blocknoteUtils vitest for default-case escaping; test run passes.

- (2026-02-16) Stage 3: Sanitized codeBlock language prop to alnum/_/- before HTML class injection.

- (2026-02-16) Stage 3 test: added blocknoteUtils language sanitization test; vitest run passes.

- (2026-02-16) Stage 3: Replaced documents blocknoteUtils with re-export shim from core.

- (2026-02-16) Stage 3 test: added documents blocknoteUtils re-export vitest; added vitest alias for @alga-psa/core/lib/blocknoteUtils to resolve shim.

- (2026-02-16) Stage 3: Updated blocknoteUtils imports to @alga-psa/core for documents, tickets, projects, client-portal callers and mocks.

- (2026-02-16) Stage 3 test: verified only remaining @alga-psa/documents/lib/blocknoteUtils import is the re-export test; all callers now use core path.
- (2026-02-16) Stage 3 test: `npx vitest run packages/client-portal/src/actions/client-portal-actions/client-tickets.responseSource.test.ts` failed due to missing table "tickets" in test setup (pre-existing); needs follow-up before marking T011.

- (2026-02-16) Stage 4: Added batch avatar helpers in media/avatarUtils using Promise.allSettled for parallel URL resolution.

- (2026-02-16) Stage 4 test: added media avatarUtils batch vitest asserting parallel URL resolution; test passes.

- (2026-02-16) Stage 4: Removed documents/lib/entityImageService and related export re-exports.

- (2026-02-16) Stage 4 test: confirmed no @alga-psa/documents/lib/entityImageService imports remain.

- (2026-02-16) Stage 4: Redirected avatar/image utilities and entity image actions to @alga-psa/media across clients, client-portal, projects, tickets, tenancy, tags, and dynamic imports.

- (2026-02-16) Stage 4 test: verified upload/delete entity image imports now come from @alga-psa/media; no remaining @alga-psa/documents/lib/avatarUtils imports.

- (2026-02-16) Stage 4: Added @alga-psa/media dependencies to client-portal, clients, projects, tenancy, tickets; replaced documents dependency in tags.
