# Client portal sidebar logo sizing

- Ticket: `alga-2026-0002529`
- Date: 2026-09-21
- Status: Design proposal; implementation not started
- Code inspected at: `2dc8454a4ccf4b701ba0b6c1e66c12a6f75f6b04`

## Problem and user value

The client portal constrains uploaded logos to 32px in its sidebar regardless of source image resolution. Square logos additionally lose their corners to a circular clipping container. Administrators cannot make their branding more legible by uploading a larger image. The expanded sidebar has room for larger artwork, while the collapsed rail needs a compact mark.

Give existing tenant artwork a larger, predictable display area in the expanded sidebar and preserve all of a square logo. Existing uploads benefit immediately without reconfiguration.

## Goals and non-goals

Improve expanded portal branding for tenants with square artwork or a wide wordmark. Preserve aspect ratio, contain artwork within the sidebar, and show square artwork without circular cropping. Keep the branding preview and portal-specific help accurate.

Out of scope: a configurable size/scale control; branding schema, database, API, storage or upload processing changes; automatic whitespace trimming; changes to MSP sidebar sizing or MSP appearance help; sign-in, email, favicon, or other logo surfaces; a shared branding component refactor; new square-image failure handling; feature flags or permission changes.

## Users and flows

- An administrator uses the existing client portal branding uploads and dashboard preview. Existing light/dark slots and edition gates still apply.
- A portal user sees a larger logo in the expanded sidebar, collapses to a compact square mark, and can use the logo link to return to the dashboard.
- Existing tenants receive the presentation change on deploy, with no re-upload or settings save.

## Evidence and affected code

`packages/client-portal/src/components/layout/ClientPortalSidebar.tsx:306-365` owns the defect: a 256px expanded or 64px collapsed rail, 16px padding, `h-8` wordmark, and `w-8 h-8 rounded-full ... overflow-hidden` uploaded square wrapper. The current selection and failed-wordmark fallback already provide the desired behavior and should remain intact.

`server/src/components/settings/general/ClientPortalSettings.tsx:560-678` owns upload help; its dashboard preview around lines 1004-1048 duplicates miniature logo geometry. The EE component re-exports this file. The corresponding portal help key is in `server/public/locales/*/msp/settings.json`.

Branding reads in `packages/tenancy/src/actions/tenant-actions/getTenantBrandingByDomain.ts` apply edition scoping. CE strips wide-logo fields via `scopeBrandingToEdition`. `uploadTenantLogo` in `packages/tenancy/src/actions/tenant-actions/tenantLogoActions.ts` persists storage URLs and does not set the display size. Neither path needs modification. The MSP sidebar uses the same `pickLogoForSurface` helper but has separate markup and is excluded.

## UX and sizing requirements

Dimensions below are CSS pixels at the default root font size; use the existing Tailwind spacing scale.

| State | Proposed behavior |
| --- | --- |
| Expanded, working wordmark | 48px-high allocation (`h-12`), automatic width capped at the available 224px, `object-contain object-left`. No company-name or organization-row duplication. |
| Expanded, uploaded square mark | 48 × 48px (`w-12 h-12`), nonshrinking, contained, with no rounded mask. Brand label retains truncation. |
| Collapsed, uploaded square mark | 32 × 32px (`w-8 h-8`), nonshrinking, contained, with no rounded mask; wide artwork and name remain hidden. |
| No uploaded square mark | Existing 32px circular built-in fallback, with existing labels and behavior. |
| Failed expanded wordmark | Existing fallback to the square branch and labels; uploaded square uses the new expanded size. |
| Dashboard settings preview | 36px-high wordmark allocation and 36 × 36px uploaded square mark (`h-9` / `w-9`), no circular square mask, contained and width-bounded. Built-in placeholder stays as-is. |

The preview retains its existing miniature layout rather than claiming pixel-for-pixel parity. The 36px logo allocation continues its previous 3/4 scale relative to the live portal. Ensure the preview's mark cannot shrink beside a long name and that the name truncates within available space.

Retain the portal rail widths, brand link padding, current theme tokens and muted logo background. Remove `rounded-full` from tenant artwork containers; do not replace it with another clipping radius. Existing rectangular bounds may remain if they do not crop contained artwork. Keep text beside the square mark in the same row; apply `min-w-0` where needed so long names truncate rather than force overflow.

A 48px image allocation does not promise 48px of visible ink for every file. For a wordmark of aspect ratio r, the visible fitted height cannot exceed min(48, 224/r) before any transparent margins. At 4:1 it can render 192 × 48px; at 8:1 it fits 224 × 28px. Do not stretch or crop to defeat the width bound. Transparent padding remains part of the source image.

Update `clientPortal.branding.help.companyLogoWide` and its inline default to: “Shown at the top of the expanded portal side panel, scaled to fit. Include your company name in the image — the panel stops printing it separately.” Update this key in every shipped locale, including pseudo-locales. Leave the separate MSP appearance help key at its current sizing description. No new controls or translation keys are required.

## Implementation sequence

1. Update only brand geometry in `ClientPortalSidebar.tsx`. Increase the expanded wordmark allocation, condition square dimensions on expansion, and remove the tenant square mask. Preserve surface-based variant selection, failed URL handling, label suppression, dashboard navigation, sidebar persistence, and built-in fallback.
2. Update the dashboard preview's uploaded-logo geometry in the server settings component. Preserve its existing edition gating, theme selection and upload flows; do not expand the mock into a live sidebar refactor.
3. Replace the portal wordmark sizing help in that component and all locale files. Scope edits by the portal key, not by a global replacement of “32px”.
4. Perform the focused validation below and record visual evidence and any limitations in the scratchpad. Do not mark checklist entries implemented during this planning assignment.

## Data, permissions, rollout and rollback

No schema, query, branding type, API, storage, upload, authentication or permission changes. Existing edition boundaries and surface-based logo selection remain unchanged. There is no migration or new tenant setting. Deploy as a portal presentation correction; rollback consists of reverting the layout, preview, and help-text edits together. No database integration suite is needed because database behavior is not being changed.

## Validation and acceptance criteria

Use browser rendering as the primary evidence for this CSS fix; source-string checks cannot prove size or cropping. Four representative scenarios are recorded in `tests.json`; these are manual browser checks, not a request to build a new test harness.

- A square fixture with visible corners occupies 48 × 48px expanded and 32 × 32px collapsed without losing artwork; a long tenant name truncates without horizontal overflow.
- A 4:1 wordmark occupies 192 × 48px in the expanded rail at default zoom. An 8:1 fixture stays within 224px width without stretching or cropping. Company name and organization labels remain suppressed only while the wordmark renders successfully.
- Light and dark surfaces choose the same variants as before, including single-variant fallback. A failed wordmark returns to square/default rendering with labels. Empty branding retains the built-in fallback. Collapsing and expanding still persists the chosen state and the logo link navigates correctly.
- The dashboard preview shows larger, uncropped uploaded artwork in both themes, and help no longer promises 32px for the portal. CE has the improved square treatment while wide uploads stay gated. MSP sidebar appearance remains unchanged.
- Check at desktop width, a narrow viewport, and 200% browser zoom: the sidebar retains its existing width policy, logos stay inside it, names truncate, and navigation remains reachable. This change does not introduce a new mobile sidebar design.
- Run existing sidebar contract tests and translation validation after implementation. Add no tests that merely assert the new class strings. Record any pre-existing failures separately.

## Risks and open questions

- Enlarging uploaded artwork increases the brand row height by 16px and reduces space for a long name; verify truncation and navigation access at short viewport heights.
- Very wide wordmarks remain width-limited; transparent padding or low-resolution source artwork can still look small or soft. The fix changes the display allocation, not the source asset.
- Preview markup is separate from the live sidebar, so it can drift. Verify both surfaces; do not introduce a broad abstraction in this bounded fix.
- Changing shared logo helpers or MSP help accidentally would broaden the blast radius. Keep geometry local and target the portal translation key precisely.
- The worktree volume was initially full; capacity recovered externally before commit (33GB free at the final check). No environment blocker remains from that observation.
- No product decision blocks implementation. The proposed 48px default is a deliberate design choice for XO review, not a claim of prior customer approval.
