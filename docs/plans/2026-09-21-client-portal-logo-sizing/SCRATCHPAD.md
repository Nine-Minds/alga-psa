# Client portal logo sizing — design notes

- Ticket: `alga-2026-0002529`.
- Inspected base: `2dc8454a4ccf4b701ba0b6c1e66c12a6f75f6b04`.
- Assignment: produce and commit a design only. Implementation and board actions are outside this assignment.
- The commissioning order specifies `docs/plans/`, overriding the alga-plan skill's default `ee/docs/plans/`. The order delegates design decisions; this proposal goes back to XO without an additional scope-confirmation round.

## Findings

- `packages/client-portal/src/components/layout/ClientPortalSidebar.tsx:296-365`: expanded wordmark uses `h-8`; uploaded square artwork uses a 32px circular clipping container; the built-in fallback also occupies 32px. Sidebar width is 256px expanded / 64px collapsed with 16px brand padding.
- Wordmark selection already follows the actual sidebar surface. A failed wordmark falls back to square artwork plus labels. Successful wordmarks suppress the brand name and organization row. Preserve those behaviors.
- `server/src/components/settings/general/ClientPortalSettings.tsx:560-678`: square uploads and optional wide uploads already exist. Wide uploads are gated by `advancedAppearanceEnabled`. Help text explicitly promises 32px. Dashboard preview around lines 1004-1048 has its own 24px logos and circular square-logo styling.
- The EE settings component re-exports the server component; the package EE placeholder is not the implementation target.
- `server/public/locales/*/msp/settings.json`: portal help key `clientPortal.branding.help.companyLogoWide` repeats the 32px claim in all 11 locale files, including pseudo-locales. The separate MSP appearance wide-logo help also says 32px and must remain unchanged.
- `packages/tenancy/src/actions/tenant-actions/getTenantBrandingByDomain.ts:242-264` reads branding and passes it through `scopeBrandingToEdition`; this is not completely verbatim as the brief describes. `packages/tenancy/src/lib/generateBrandingStyles.ts` strips wide logo fields in CE. No size setting is introduced.
- `packages/tenancy/src/actions/tenant-actions/tenantLogoActions.ts:27-105` delegates upload to storage and persists the URL. It does not impose the sidebar display size. Storage image processing itself was not audited; no change there is needed to resolve the confirmed CSS constraint.
- `server/src/components/layout/Sidebar.tsx:74-82,304-326` shares variant selection semantics but owns separate MSP geometry. It is outside this fix.
- Existing sidebar contract tests inspect source text; they cannot establish rendered dimensions or unclipped artwork. Use browser evidence for this CSS change rather than adding more source-string assertions.

## Decisions

- Use a 48px expanded logo allocation for both wordmarks and uploaded square marks, retaining 32px square marks when collapsed. This also benefits CE and tenants without a wordmark.
- Preserve the built-in 32px circular fallback. Remove the circular mask only from tenant square artwork in both sidebar states and the dashboard preview.
- Bound wordmarks by the 224px expanded content width; preserve aspect ratio and left alignment. Extremely wide art may remain less than 48px tall because width is the limiting dimension.
- Use 36px logo allocations in the miniature dashboard preview, retaining its current 3/4 logo scale. Its narrower rail also limits wordmark width.
- No new setting, schema, API, shared logo abstraction, or MSP appearance change.
- Six implementation checklist items and four representative validation scenarios are enough for this bounded presentation fix. All remain pending in this design assignment.

## Workspace notes

- `package-lock.json` was already modified on arrival; exclude it from the plan commit.
- Initial `git status` index refresh failed with out-of-disk-space on the shared `/home/robert/alga-copies` btrfs mount. Read-only inspection succeeded with `GIT_OPTIONAL_LOCKS=0`. The root filesystem has free capacity; avoid any broad cleanup or changes to other worktrees.
- Capacity recovered externally during planning: the final check showed 33GB available and staging succeeded. This assignment performed no cache deletion, service restart or filesystem repair.
- Plan validator passed with six pending features and four pending validation scenarios; staged whitespace validation passed. Product tests and browser validation are deferred to implementation because no product code changed.

## Validation commands

Validate the plan with `python3 /home/robert/.codex/skills/alga-plan/scripts/validate_plan.py docs/plans/2026-09-21-client-portal-logo-sizing` and review the staged diff with `git diff --cached --check`.

During implementation, run the existing sidebar contract suite from `packages/client-portal` with `npx vitest run src/components/layout/ClientPortalSidebar.contract.test.ts`. Run `node scripts/validate-translations.cjs` from the repository root after the localized help edits. These are regression checks; the browser scenarios in `tests.json` establish the actual visual behavior.
