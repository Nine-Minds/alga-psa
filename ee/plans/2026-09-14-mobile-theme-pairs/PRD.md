# PRD — Mobile theme pairs

- Slug: `mobile-theme-pairs`
- Date: `2026-09-14`
- Status: Draft
- Tracking: Mobile App project, 1.6 Mobile phase (task to be created on approval)

## Summary

The web app lets a tenant pick one of nine theme pairs (Alga, Slate, Ocean, Sky, Forest, Sunset, Cappuccino, Vice, High contrast) or, on Enterprise, a custom pair, and every user sees the light or dark half according to their own preference. The mobile app ignores all of this and ships a single purple Alga look. This plan makes the mobile app render the tenant's chosen pair, including custom pairs, without hard-coding any palette in the app.

## Problem

- An MSP that branded its PSA as Forest or a custom palette opens the phone app and gets purple. For white-label tenants this is a visible defect, not a cosmetic one.
- The mobile theme layer is a pair of hand-written `lightTheme` / `darkTheme` objects with about twenty colour tokens. Nothing on the server tells the app which pair the tenant chose.
- The app also has no user-facing appearance setting: the light/dark/system preference hook exists but nothing in Settings calls it, so the app silently follows the OS.
- Twenty-four hard-coded hex colours sit outside the theme file and would ignore any theme.
- The rich-text comment editor is a web view with its own inline light CSS, so it stays white even in dark mode today.

## Goals

- Render the tenant's chosen theme pair on mobile, for all nine predefined pairs and for custom pairs, in both light and dark.
- Derive the mobile palette from the same 15 seed tokens the web uses, with the same ramp maths, so the two apps match without a second copy of every colour.
- Never bake a tenant palette into the app binary: the pair comes from the server and is cached on the device.
- Give users the light/dark/system choice in Settings, mirroring the per-user toggle on the web.
- Keep the app usable offline and against servers that predate this feature.

## Non-goals

- A per-user theme pair override on mobile. On the web the pair is tenant-wide; mobile follows the same rule.
- Editing the tenant theme from mobile.
- Theming the sign-in screens before a server is known. They keep the built-in Alga look until capabilities load.
- Replicating web-only chrome such as the sidebar, header, submenu and table tokens; mobile has no equivalents.
- Fonts, spacing, radii, or shadows. Only colour changes.
- Client-portal theming (the mobile app is MSP-only).

## Users and Primary Flows

- **Technician on a themed tenant.** Signs in, the app loads capabilities, and every screen adopts the tenant pair. Switching the phone between light and dark, or choosing an explicit mode in Settings, swaps to the other half of the pair.
- **Technician offline.** Opens the app without connectivity and sees the last cached pair, not a flash of purple.
- **Admin changes the tenant theme on the web.** The next time a phone refreshes capabilities (launch, resume, or pull to refresh on Settings) it adopts the new pair.
- **Tenant on Community Edition.** Sees the predefined pair the admin chose; `custom` cannot be selected there, so nothing custom-specific is needed.
- **Server older than this feature.** Capabilities lack a theme block; the app keeps the built-in Alga pair.

## UX / UI Notes

- No new screens. Settings gains an "Appearance" row under a new "Appearance" section with three choices: System, Light, Dark. The row's value shows the current choice. A second, read-only row shows the tenant theme name with the hint "Set by your administrator in AlgaPSA settings". For a custom pair the name reads "Custom".
- The theme applies instantly when capabilities load; no restart. A change from the web is picked up on the next capabilities refresh with no interstitial.
- Cold launch: the app reads the cached tokens before first render so there is no purple flash on a Forest tenant. If nothing is cached yet (first launch after upgrade), the first frame is Alga and the pair applies as soon as capabilities return.
- High contrast: card borders use the strong border token and badges gain a one-pixel border in the matching status colour, mirroring the web's extra treatment for that pair.
- Status colours (danger, warning, success, info) stay fixed per mode across all pairs, as on the web, where they are not part of the pair tokens. Their badge and toast backgrounds are derived by mixing the status colour with the pair's card colour so they sit correctly on dark pairs.
- Avatar identity colours (the hashed per-person palette) are intentionally not themed.
- The comment editor web view receives the current background, text, link, and mention colours through its bridge so comments read correctly in dark and custom pairs.

## Requirements

### Functional Requirements

**Server**

- FR1. `GET /api/v1/mobile/me/capabilities` returns a `theme` object: `{ pairId, label, light: SeedTokens, dark: SeedTokens, version }`.
- FR2. For a predefined pair, `light`/`dark` are the pair's preset seed tokens from `CUSTOM_THEME_PRESETS`. For `custom`, they are the tenant's saved custom tokens; if the saved tokens fail validation, the response falls back to the Alga preset and reports `pairId: "alga"`.
- FR3. `version` is a stable hash of `pairId` plus both token sets, so the app can cheaply tell whether anything changed.
- FR4. The OpenAPI entry for the capabilities endpoint documents the theme block and the seed token schema.
- FR5. The seed token schema is the existing 15 keys; no new keys are introduced.

**Mobile theme engine**

- FR6. A pure `buildTheme(tokens, mode, options)` produces a full `Theme` from 15 seed tokens. It ports the web's `mix`, `rampFromStops`, and `brandRamp` maths so ramp stops match the web exactly.
- FR7. Token mapping: background←background; card←card; text←textPrimary; textSecondary←textSecondary; placeholder←textMuted; border←border; borderLight←neutral ramp stop 100; primary←primary; primaryLight←primary ramp 200; primaryDark←primary ramp 700; secondary←secondary ramp 700 (light) / 300 (dark); cyan←secondary ramp 500; accent←accent; textInverse←white when the primary is dark enough for 4.5:1 against white, else textPrimary; shadow stays black.
- FR8. Status colours per mode are constants matching the web base tokens; badge and toast sets are derived from status colour and card colour with fixed mix ratios per mode.
- FR9. `buildTheme` never throws on bad input: an invalid token falls back to the corresponding built-in Alga value for that mode and the failure is recorded once through the logger.
- FR10. The current `lightTheme` and `darkTheme` exports remain and are regenerated by `buildTheme` from the Alga preset, so nothing that imports them changes behaviour.

**Mobile theme delivery**

- FR11. `ThemeProvider` resolves the active pair from the capabilities context; when no theme block is present it uses the built-in Alga pair.
- FR12. The theme block is cached in secure storage keyed by server base URL and tenant, and read synchronously enough that the first frame after a warm launch uses the cached pair.
- FR13. Signing out or switching servers clears the cached theme so a different tenant's colours never leak across accounts.
- FR14. A newer `version` from the server replaces the cache and re-renders without restart.
- FR15. The light/dark/system preference keeps its existing storage and semantics; it selects which half of the pair renders.

**Settings**

- FR16. Settings gains an Appearance section with a three-way row (System, Light, Dark) bound to the existing preference hook.
- FR17. A read-only "Theme" row shows the pair label from the server ("Custom" for custom) with the administrator hint, or "Default" when the server sent no theme.

**Hard-coded colour sweep**

- FR18. The image preview overlay, scan view chrome, sign-in, mention list, and materials section use theme tokens instead of literal hex values, except for overlay scrims that are intentionally black and avatar identity colours.
- FR19. A lint rule (ESLint `no-restricted-syntax` on hex literals in `src/**`, with an allow-list for `themes.ts`, `colors.ts`, `tagColors.ts`, `Avatar.tsx`, and the generated editor HTML) prevents new literals.

**Comment editor**

- FR20. The rich-text editor web view accepts a theme payload (background, text, secondary text, link, mention background, mention text) through its existing bridge and applies it as CSS variables on load and on change.
- FR21. Read-only comment renderers pass the same payload so comment bodies match the surrounding card.

**High contrast**

- FR22. When `pairId` is `high-contrast`, card and row borders use the strong border token and badges draw a one-pixel border in their status colour.

### Non-functional Requirements

- Building a theme from tokens runs under one millisecond on device; it is memoised per `(version, mode)`.
- Every predefined pair passes the web's contrast checks (`validateCustomThemeContrast`) once mapped to mobile tokens, in both modes.
- No native rebuild is required; this is a JavaScript-only change to the app.
- Existing 970+ mobile tests keep passing; components that read `useTheme()` need no changes.

## Data / API / Integrations

- **Source of truth**: `tenant_settings.settings.theme` via `getTenantThemeByTenantId` in `packages/tenancy/src/lib/tenantTheme.ts`; presets in `packages/tenancy/src/lib/customTheme.ts` (`CUSTOM_THEME_PRESETS`, `findInvalidCustomThemeTokens`, `validateCustomThemeContrast`). A server unit test already pins presets to `globals.css`, so presets are safe to treat as canonical.
- **Endpoint**: extend `MobileCapabilitiesService.getMyCapabilities` in `server/src/lib/api/services/MobileCapabilitiesService.ts` (controller `ApiMobileCapabilitiesController`). Response stays `{ features, theme }`; `theme` is additive.
- **Mobile client**: `ee/mobile/src/api/capabilities.ts` type gains `theme?: MobileTheme`; `CapabilitiesProvider` exposes it; `ThemeProvider` consumes it. Cache key `alga.mobile.theme.tokens.<baseUrl>.<tenantId>`.
- **Ramp maths**: `mix`, `rampFromStops`, `brandRamp` are copied into `ee/mobile/src/ui/themeMath.ts`. The mobile package cannot import `@alga-psa/tenancy` (different bundle), so a mobile unit test pins the copy against fixture outputs generated from the web implementation to catch drift.
- **Editor bridge**: `ee/mobile/src/features/ticketRichText/bridge.ts` gains a `setTheme` message; the generated HTML gains CSS variables with the current light defaults.

## Security / Permissions

- The theme block is read-only tenant metadata already visible to every signed-in user of that tenant on the web; no new permission is needed.
- Custom tokens are validated on the server before being sent (hex format), so the app never evaluates untrusted colour strings beyond parsing.

## Rollout / Migration

- No database migration. No native build.
- Backwards compatible in both directions: old apps ignore the new `theme` field; new apps without the field keep Alga.
- Ship order: server change first (safe on its own), then the app in the next TestFlight/Play build.

## Open Questions

1. Should the read-only "Theme" row link to the web appearance settings for admins, or stay informational? (Plan assumes informational.)
2. Should the sign-in screens adopt the last cached pair for the same server, or always stay Alga until sign-in completes? (Plan assumes Alga until sign-in; a cached pair could show a different tenant's colours on a shared device.)
3. Is a "match web exactly" contrast gate required for custom pairs on mobile, or do we trust the web editor's validation at save time? (Plan assumes trust the web; the app only guards against malformed tokens.)

## Acceptance Criteria (Definition of Done)

- On a tenant set to each of the nine predefined pairs, the app matches the web's colours for background, card, text, borders, and primary in both light and dark, verified by the pinned fixture test and a device pass.
- On an Enterprise tenant with a custom pair, the app renders the custom tokens; with corrupted saved tokens it renders Alga and logs once.
- Changing the pair on the web shows on the phone after the next capabilities refresh with no restart.
- Warm launch on a Forest tenant shows no Alga frame; signing out and into a different tenant shows the correct pair with no leakage.
- Settings shows the Appearance row and the Theme row; the appearance choice persists across restarts.
- No hex literals remain outside the allow-listed files, and the lint rule blocks new ones.
- Comment bodies in the editor and in read-only comments follow the active theme.
- High-contrast tenants get strong borders and bordered badges.
- Mobile typecheck, lint, and full test suite green; server unit tests for the capabilities service green.
