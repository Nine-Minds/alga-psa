# Scratchpad: AI Streaming + Experimental Features

## Key Discoveries

### Storage Location for Experimental Features
After exploring the codebase, the **best location** for experimental feature settings is:

**Recommended: `tenant_settings.settings` JSONB column**
- Already exists in `tenant_settings` table
- Pattern already used for analytics settings (`settings.analytics`)
- No migration needed for schema changes - just add keys to JSONB
- Access via existing `getTenantSettings()` / `updateTenantSettings()` actions
- Location: `/packages/tenancy/src/actions/tenant-settings-actions/tenantSettingsActions.ts`

**Alternative considered but rejected:**
- PostHog feature flags: External dependency, not tenant-controlled
- Separate table: Overkill for simple boolean toggles
- Environment variables: Not tenant-specific

### Current AI Gating
- AI features currently gated by `isEnterpriseEdition` check (edition-level)
- No tenant-level gating exists currently
- Quick Ask and Chat both require EE but don't check tenant preferences

### Relevant Files
- Settings page: `/server/src/components/settings/SettingsPage.tsx`
- Tenant settings actions: `/packages/tenancy/src/actions/tenant-settings-actions/tenantSettingsActions.ts`
- Feature flags (for reference): `/server/src/lib/feature-flags/featureFlags.ts`
- DefaultLayout (Quick Ask trigger): `/server/src/components/layout/DefaultLayout.tsx`
- QuickAskOverlay: `/server/src/components/chat/QuickAskOverlay.tsx` (CE stub)
- QuickAskOverlay (EE): `/ee/server/src/components/chat/QuickAskOverlay.tsx`
- RightSidebar: `/server/src/components/layout/RightSidebar.tsx`
- Chat completions: `/ee/server/src/services/chatCompletionsService.ts`
- Chat stream: `/ee/server/src/services/chatStreamService.ts`

### Existing Streaming Infrastructure
- SSE endpoints exist at `/api/chat/stream/*`
- `ChatStreamService` handles streaming but uses simulated typing effect currently
- OpenRouter supports streaming via OpenAI SDK
- Need to implement true token-by-token streaming

### Settings Tab Pattern
Tabs are added to SettingsPage.tsx with:
1. Tab label in `tabLabels` array
2. Tab slug in `tabLabelToSlug` mapping
3. Content component in tabs array with lazy loading

## Decisions

1. **Experimental features stored in `tenant_settings.settings.experimentalFeatures`**
2. **AI Assistant is the first (and only initial) experimental feature** - key: `aiAssistant`
3. **Check tenant setting before allowing Quick Ask/Chat activation**
4. **Streaming will use OpenRouter's native streaming via OpenAI SDK**
5. **Permission**: Reuse `settings:update` permission (no new permission needed)
6. **Effect timing**: Page reload is acceptable after toggling - simpler than real-time context refresh

## Open Questions (resolved)

1. Q: Where to store experimental features?
   A: `tenant_settings.settings.experimentalFeatures` JSONB

2. Q: How to gate Quick Ask globally?
   A: Check tenant setting in DefaultLayout before opening overlay

## Commands / Runbook

```bash
# Test tenant settings
curl -X GET localhost:3000/api/v1/tenant-settings

# Check current streaming endpoint
curl -X POST localhost:3000/api/chat/stream/chat \
  -H "Content-Type: application/json" \
  -d '{"inputs": [{"role": "user", "content": "Hello"}]}'
```

## Work Log

### 2026-01-23
- Implemented `getExperimentalFeatures()` server action returning `tenant_settings.settings.experimentalFeatures` (defaults to `{}` when unset): `packages/tenancy/src/actions/tenant-settings-actions/tenantSettingsActions.ts`
- Implemented `updateExperimentalFeatures(features)` server action with `settings:update` permission check and merge-into-JSON behavior via `updateTenantSettings()`: `packages/tenancy/src/actions/tenant-settings-actions/tenantSettingsActions.ts`
- Validation: `npm -w @alga-psa/tenancy run typecheck`
- Implemented `isExperimentalFeatureEnabled(featureKey)` server action (strict `=== true` check; unknown/unset keys return false): `packages/tenancy/src/actions/tenant-settings-actions/tenantSettingsActions.ts`
- Validation: `npm -w @alga-psa/tenancy run typecheck`
- Implemented `ExperimentalFeaturesSettings` client component with load-on-mount + local toggle state: `server/src/components/settings/general/ExperimentalFeaturesSettings.tsx`
- Validation: `npx eslint server/src/components/settings/general/ExperimentalFeaturesSettings.tsx --max-warnings=0`
- Note: `npm -w server run typecheck` currently fails due to missing `@ee/components/chat/QuickAskOverlay` module import in `server/src/components/chat/QuickAskOverlay.tsx` (unrelated to experimental features UI).
- Implemented "Experimental Features" settings entry point:
  - Added `experimental-features` slug mapping + tab content using dynamic import: `server/src/components/settings/SettingsPage.tsx`
  - Added Settings sidebar navigation item linking to `/msp/settings?tab=experimental-features`: `server/src/config/menuConfig.ts`
  - Validation: `npx eslint server/src/components/settings/SettingsPage.tsx server/src/config/menuConfig.ts --max-warnings=0`
- Implemented AI Assistant toggle display copy per PRD (name + description): `server/src/components/settings/general/ExperimentalFeaturesSettings.tsx`
- Validation: `npx eslint server/src/components/settings/general/ExperimentalFeaturesSettings.tsx --max-warnings=0`
- Added warning banner copy for experimental feature stability: `server/src/components/settings/general/ExperimentalFeaturesSettings.tsx`
- Validation: `npx eslint server/src/components/settings/general/ExperimentalFeaturesSettings.tsx --max-warnings=0`
- Wired Save button to persist experimental feature toggles via `updateExperimentalFeatures()`; includes disabled state when unchanged and a success toast reminding to reload: `server/src/components/settings/general/ExperimentalFeaturesSettings.tsx`
- Validation: `npx eslint server/src/components/settings/general/ExperimentalFeaturesSettings.tsx --max-warnings=0`
- Implemented default-disabled experimental features behavior:
  - `getExperimentalFeatures()` now normalizes unset/malformed values to `{ aiAssistant: false }`: `packages/tenancy/src/actions/tenant-settings-actions/tenantSettingsActions.ts`
  - `initializeTenantSettings()` now seeds `settings.experimentalFeatures` with `{ aiAssistant: false }` for new tenants: `packages/tenancy/src/actions/tenant-settings-actions/tenantSettingsActions.ts`
- Implemented Quick Ask shortcut gating (⌘↑/Ctrl↑) behind `aiAssistant` experimental feature flag in `DefaultLayout` (disabled until flag loads; no `preventDefault` when disabled): `server/src/components/layout/DefaultLayout.tsx`
- Validation: `npx eslint server/src/components/layout/DefaultLayout.tsx --max-warnings=0`
- Implemented Quick Ask overlay gating (only render `QuickAskOverlay` when `aiAssistant` is enabled): `server/src/components/layout/DefaultLayout.tsx`
- Validation: `npx eslint server/src/components/layout/DefaultLayout.tsx --max-warnings=0`
- Note: `npm -w server run typecheck` still fails with `TS2307` for `@ee/components/chat/QuickAskOverlay` from `server/src/components/chat/QuickAskOverlay.tsx` (pre-existing).
- Implemented Sidebar Chat gating:
  - ⌘L/Ctrl+L shortcut now ignored unless `aiAssistant` is enabled (no `preventDefault` when disabled)
  - Right sidebar is not rendered unless `aiAssistant` is enabled; also auto-closes if disabled
  - Updated Quick Ask “Open in Sidebar” handoff to no-op if `aiAssistant` is disabled
  - File: `server/src/components/layout/DefaultLayout.tsx`
- Validation: `npx eslint server/src/components/layout/DefaultLayout.tsx --max-warnings=0`
- Implemented API gating for chat completions:
  - `/api/chat/v1/completions` returns 403 with `"AI Assistant is not enabled for this tenant"` when `aiAssistant` is disabled
  - File: `server/src/app/api/chat/v1/completions/route.ts`
- Validation: `npx eslint server/src/app/api/chat/v1/completions/route.ts` (existing `no-undef` warnings for `process` in route handlers)
- Note: `npm -w server run lint` currently fails (`next lint` reports invalid project directory `/server/lint`).
- Implemented API gating for chat execute:
  - `/api/chat/v1/execute` returns 403 with `"AI Assistant is not enabled for this tenant"` when `aiAssistant` is disabled
  - File: `server/src/app/api/chat/v1/execute/route.ts`
- Validation: `npx eslint server/src/app/api/chat/v1/execute/route.ts` (existing `no-undef` warnings for `process` in route handlers)
- Implemented API gating for chat streaming:
  - `/api/chat/stream/title` returns 403 with `"AI Assistant is not enabled for this tenant"` when `aiAssistant` is disabled
  - `/api/chat/stream/*` (slugged) returns 403 with `"AI Assistant is not enabled for this tenant"` when `aiAssistant` is disabled
  - Files: `server/src/app/api/chat/stream/title/route.ts`, `server/src/app/api/chat/stream/[...slug]/route.ts`
- Validation: `npx eslint server/src/app/api/chat/stream/title/route.ts server/src/app/api/chat/stream/[...slug]/route.ts --max-warnings=0`
- Note: `npm -w server run typecheck` still fails with `TS2307` for `@ee/components/chat/QuickAskOverlay` from `server/src/components/chat/QuickAskOverlay.tsx` (pre-existing).
- Implemented `/api/chat/v1/completions/stream` POST endpoint returning an SSE response (placeholder stream) with EE + `aiAssistant` gating:
  - File: `server/src/app/api/chat/v1/completions/stream/route.ts`
  - Note: currently sends a single SSE comment (`: ok`) then closes; token streaming is implemented in later items.
- Validation: `npx eslint server/src/app/api/chat/v1/completions/stream/route.ts`
- Implemented OpenRouter streaming support in ChatCompletionsService:
  - Added `createRawCompletionStream()` public helper for later SSE endpoints
  - Added `generateStreamingCompletion()` internal helper that calls OpenRouter with `stream: true`
  - File: `ee/server/src/services/chatCompletionsService.ts`
- Validation: `npm -w sebastian-ee run typecheck` currently fails due to pre-existing TS2307 imports in `ee/server/src/components/chat/QuickAskOverlay.tsx` (unrelated to streaming support)
- Implemented SSE token chunk formatting for streaming completions endpoint:
  - `/api/chat/v1/completions/stream` now reads request `messages` and streams tokens as `data: {"content":"...","done":false}\n\n`
  - File: `server/src/app/api/chat/v1/completions/stream/route.ts`
- Validation: `npx eslint server/src/app/api/chat/v1/completions/stream/route.ts --max-warnings=0`
- Implemented final SSE completion event:
  - `/api/chat/v1/completions/stream` now sends `data: {"content":"","done":true}\n\n` when the upstream stream completes (best-effort; skipped when request is aborted)
  - File: `server/src/app/api/chat/v1/completions/stream/route.ts`
- Validation: `npx eslint server/src/app/api/chat/v1/completions/stream/route.ts --max-warnings=0`
- Implemented Chat.tsx wiring to streaming endpoint:
  - `ee/server/src/components/chat/Chat.tsx` now posts to `/api/chat/v1/completions/stream`
  - Reads SSE response via `response.body.getReader()` and reconstructs final assistant content from `data: {content, done}` events
  - Note: UI still uses existing “typing” reveal once streaming completes; incremental token display is handled in the next feature item.
- Validation: `npx eslint ee/server/src/components/chat/Chat.tsx` (warnings present in file; no errors)
- Implemented true incremental token rendering in Chat.tsx:
  - `readAssistantContentFromSse()` now supports per-token callbacks
  - `handleSend()` updates `incomingMessage` as tokens arrive (throttled to animation frames) and removes the simulated typewriter reveal
  - Added `generationIdRef` guard so Stop invalidates the active generation and prevents late stream updates/persistence from racing in (does not abort the network request yet)
  - File: `ee/server/src/components/chat/Chat.tsx`
- Validation: `npx eslint ee/server/src/components/chat/Chat.tsx` (warnings present in file; no errors)
- Validation: `npm -w sebastian-ee run typecheck` still fails due to pre-existing TS2307 imports in `ee/server/src/components/chat/QuickAskOverlay.tsx` (unrelated to F021)
- Implemented AbortController cancellation for true streaming:
  - `handleSend()` creates an `AbortController` per generation and passes `signal` to `fetch()`
  - Stop button now triggers `AbortController.abort()` so the network request is actually canceled mid-stream (no error banner for AbortError)
  - File: `ee/server/src/components/chat/Chat.tsx`
- Validation: `npx eslint ee/server/src/components/chat/Chat.tsx`
- Next feature item: F023 Display streaming indicator/cursor while tokens are being received

### 2026-01-23 (cont.)
- Implemented streaming cursor indicator while tokens are being received:
  - Added `showStreamingCursor` prop to `Message` and render a blinking cursor glyph (`▍`) after markdown content
  - Wired Chat incoming assistant message to set `showStreamingCursor={generatingResponse && !isFunction}` so it only shows during token streaming (not during the initial “Thinking...” phase)
  - Files: `ee/server/src/components/message/Message.tsx`, `ee/server/src/components/message/message.css`, `ee/server/src/components/chat/Chat.tsx`
- Validation: `npx eslint ee/server/src/components/chat/Chat.tsx ee/server/src/components/message/Message.tsx --max-warnings=9999` (warnings present; no errors)
- Next feature item: F024 Handle stream interruption gracefully - show partial response with error indicator

### 2026-01-23 (cont.)
- Implemented graceful stream interruption handling:
  - If the SSE stream ends without a `done: true` event, Chat now treats it as an interruption and shows the partial assistant content with an "Interrupted" indicator.
  - If a non-abort network/error occurs mid-stream, Chat shows the partial assistant content (if any) with an "Interrupted" indicator.
  - Partial/interrupted responses are not persisted; only fully completed (`done: true`) responses are persisted.
  - Files: `ee/server/src/components/chat/Chat.tsx`, `ee/server/src/components/message/Message.tsx`, `ee/server/src/components/message/message.css`
- Validation: `npx eslint ee/server/src/components/chat/Chat.tsx ee/server/src/components/message/Message.tsx --max-warnings=9999` (warnings present; no errors)
- Next feature item: F025 Persist assistant message to database after streaming completes (final content)

### 2026-01-24
- Finalized assistant message persistence after streaming completes:
  - Streaming completions now stash the persisted assistant message id per-generation (ref) so UI messages never reuse a prior assistant id when persistence is skipped (interrupts) or fails.
  - Only completed streams (`done: true`) attempt persistence; interrupted/partial messages still render but never persist.
  - File: `ee/server/src/components/chat/Chat.tsx`
- Validation: `npx eslint ee/server/src/components/chat/Chat.tsx --max-warnings=9999` (warnings present; no errors)
- Next feature item: F026 Ensure Quick Ask expanded state uses streaming for responses

- Fixed EE Quick Ask overlay module wiring so the expanded view can use the streaming `Chat` implementation:
  - Added `@ee/components/chat/QuickAskOverlay` shim that re-exports the real EE overlay from `ee/server`: `packages/ee/src/components/chat/QuickAskOverlay.tsx`
  - Updated EE overlay to use shared UI components (`@alga-psa/ui`) instead of non-existent `server/src/components/ui/*` imports: `ee/server/src/components/chat/QuickAskOverlay.tsx`
- Validation: `npm -w server run typecheck`
- Next feature item: F027 Ensure Sidebar Chat uses streaming for responses

- Fixed Sidebar Chat EE component wiring so Sidebar chat renders the EE streaming `Chat` implementation (including for CE-first localhost dev):
  - Replaced `@ee/components/layout/RightSidebar` CE stub with a re-export shim to `ee/server`: `packages/ee/src/components/layout/RightSidebar.tsx`
- Validation: `npm -w server run typecheck`
- Next item: T001 getExperimentalFeatures() returns defaults when tenant settings are unavailable

### 2026-01-24 (cont.)
- Implemented T001 (unit test):
  - Added Vitest unit test covering the no-tenant/no-settings path; expects `{ aiAssistant: false }` defaults (PRD goal: experimental features default disabled).
  - File: `server/src/test/unit/tenantSettingsActions.experimentalFeatures.test.ts`
  - Note: Updated `tests.json` wording since `getExperimentalFeatures()` intentionally normalizes to defaults rather than returning `{}`.
- Validation: `npx vitest run server/src/test/unit/tenantSettingsActions.experimentalFeatures.test.ts` (repo-root `npm run test:local` currently fails due to `dotenv -e` CLI incompatibility)
- Next test item: T002 getExperimentalFeatures() returns saved experimental features from tenant_settings

### 2026-01-24 (cont.)
- Implemented T002 (unit test):
  - Added Vitest unit test covering the saved-settings path; expects stored `experimentalFeatures.aiAssistant: true` to be returned as `{ aiAssistant: true }`.
  - File: `server/src/test/unit/tenantSettingsActions.experimentalFeatures.test.ts`
- Validation: `npx vitest run server/src/test/unit/tenantSettingsActions.experimentalFeatures.test.ts`
- Next test item: T003 updateExperimentalFeatures() creates settings entry if none exists

### 2026-01-24 (cont.)
- Implemented T003 (unit test):
  - Verifies `updateExperimentalFeatures()` upserts `tenant_settings` via `insert(...).onConflict('tenant').merge(...)` when no settings row exists.
  - Asserts written JSON includes `experimentalFeatures.aiAssistant: true`.
  - File: `server/src/test/unit/tenantSettingsActions.experimentalFeatures.test.ts`
- Validation: `npx vitest run server/src/test/unit/tenantSettingsActions.experimentalFeatures.test.ts`
- Next test item: T004 updateExperimentalFeatures() merges with existing settings without overwriting other keys

### 2026-01-24 (cont.)
- Implemented T004 (unit test):
  - Verifies `updateExperimentalFeatures()` preserves unrelated `tenant_settings.settings` keys (e.g. `analytics`) while updating `experimentalFeatures`.
  - File: `server/src/test/unit/tenantSettingsActions.experimentalFeatures.test.ts`
- Validation: `npx vitest run server/src/test/unit/tenantSettingsActions.experimentalFeatures.test.ts`
- Next test item: T005 updateExperimentalFeatures() requires settings:update permission

### 2026-01-24 (cont.)
- Implemented T005 (unit test):
  - Verifies `updateExperimentalFeatures()` rejects when the current user lacks `settings:update`.
  - Asserts no tenant DB access occurs (permission check happens before settings load/write).
  - File: `server/src/test/unit/tenantSettingsActions.experimentalFeatures.test.ts`
- Validation: `npx vitest run server/src/test/unit/tenantSettingsActions.experimentalFeatures.test.ts`
- Next test item: T006 isExperimentalFeatureEnabled() returns false for unknown feature keys

### 2026-01-24 (cont.)
- Implemented T006 (unit test):
  - Verifies `isExperimentalFeatureEnabled()` returns `false` for unknown keys (even when `aiAssistant` is enabled).
  - File: `server/src/test/unit/tenantSettingsActions.experimentalFeatures.test.ts`
- Validation: `npx vitest run server/src/test/unit/tenantSettingsActions.experimentalFeatures.test.ts`
- Next test item: T007 isExperimentalFeatureEnabled('aiAssistant') returns false when not set

### 2026-01-24 (cont.)
- Implemented T007 (unit test):
  - Verifies `isExperimentalFeatureEnabled('aiAssistant')` resolves to `false` when `tenant_settings.settings.experimentalFeatures.aiAssistant` is unset.
  - File: `server/src/test/unit/tenantSettingsActions.experimentalFeatures.test.ts`
- Validation: `npx vitest run server/src/test/unit/tenantSettingsActions.experimentalFeatures.test.ts`
- Next test item: T008 isExperimentalFeatureEnabled('aiAssistant') returns true when enabled

### 2026-01-24 (cont.)
- Implemented T008 (unit test):
  - Verifies `isExperimentalFeatureEnabled('aiAssistant')` resolves to `true` when `tenant_settings.settings.experimentalFeatures.aiAssistant` is set to `true`.
  - File: `server/src/test/unit/tenantSettingsActions.experimentalFeatures.test.ts`
- Validation: `npx vitest run server/src/test/unit/tenantSettingsActions.experimentalFeatures.test.ts`
- Next test item: T009 ExperimentalFeaturesSettings component renders list of features with toggles

### 2026-01-24 (cont.)
- Implemented T009 (unit test):
  - Verifies the Experimental Features settings page renders feature rows with toggles (UI reflection `data-automation-id` on switches).
  - File: `server/src/test/unit/components/ExperimentalFeaturesSettings.test.tsx`
  - Note: Added missing Vitest alias mapping for `@alga-psa/tenancy/actions` so client settings components can be tested under Vitest.
    - File: `server/vitest.config.ts`
- Validation: `npx vitest run server/src/test/unit/components/ExperimentalFeaturesSettings.test.tsx`
- Next test item: T010 ExperimentalFeaturesSettings loads current settings on mount

### 2026-01-24 (cont.)
- Implemented T010 (unit test):
  - Verifies the feature toggle reflects the value loaded from `getExperimentalFeatures()` on mount (`aria-checked` state updates).
  - File: `server/src/test/unit/components/ExperimentalFeaturesSettings.test.tsx`
- Validation: `npx vitest run server/src/test/unit/components/ExperimentalFeaturesSettings.test.tsx`
- Next test item: T011 ExperimentalFeaturesSettings toggle updates local state

### 2026-01-24 (cont.)
- Implemented T011 (unit test):
  - Verifies clicking the switch updates local UI state (`aria-checked` flips without saving).
  - File: `server/src/test/unit/components/ExperimentalFeaturesSettings.test.tsx`
- Validation: `npx vitest run server/src/test/unit/components/ExperimentalFeaturesSettings.test.tsx`
- Next test item: T012 Experimental Features tab appears in Settings navigation

### 2026-01-24 (cont.)
- Implemented T012 (unit test):
  - Verifies Settings navigation includes an "Experimental Features" entry pointing at `?tab=experimental-features`.
  - File: `server/src/test/unit/menuConfig.experimentalFeatures.test.ts`
- Validation: `npx vitest run server/src/test/unit/menuConfig.experimentalFeatures.test.ts`
- Next test item: T013 Experimental Features tab loads lazily

### 2026-01-24 (cont.)
- Implemented T013 (unit test):
  - Verifies SettingsPage wires the Experimental Features tab via `next/dynamic` (lazy load).
  - File: `server/src/test/unit/SettingsPage.experimentalFeatures.lazy.test.ts`
  - Added test stubs/aliases so SettingsPage can be imported in Vitest without resolving product-only extension entrypoints.
    - Files: `server/src/test/stubs/product-settings-extensions-entry.ts`, `server/vitest.config.ts`
- Validation: `npx vitest run server/src/test/unit/SettingsPage.experimentalFeatures.lazy.test.ts`
- Next test item: T014 AI Assistant feature shows name 'AI Assistant' and description

### 2026-01-24 (cont.)
- Implemented T014 (unit test):
  - Verifies the AI Assistant feature row renders the expected name + description text.
  - File: `server/src/test/unit/components/ExperimentalFeaturesSettings.test.tsx`
- Validation: `npx vitest run server/src/test/unit/components/ExperimentalFeaturesSettings.test.tsx`
- Next test item: T015 AI Assistant toggle defaults to off

### 2026-01-24 (cont.)
- Implemented T015 (unit test):
  - Verifies AI Assistant defaults to off when the server returns no saved value (unset key).
  - File: `server/src/test/unit/components/ExperimentalFeaturesSettings.test.tsx`
- Validation: `npx vitest run server/src/test/unit/components/ExperimentalFeaturesSettings.test.tsx`
- Next test item: T016 Warning banner displays experimental features disclaimer

### 2026-01-24 (cont.)
- Implemented T016 (unit test):
  - Verifies the warning banner copy renders on the Experimental Features settings screen.
  - File: `server/src/test/unit/components/ExperimentalFeaturesSettings.test.tsx`
- Validation: `npx vitest run server/src/test/unit/components/ExperimentalFeaturesSettings.test.tsx`
- Next test item: T017 Save button calls updateExperimentalFeatures() with current toggle states

### 2026-01-24 (cont.)
- Implemented T017 (unit test):
  - Verifies Save calls `updateExperimentalFeatures()` with the current toggle state after changing it.
  - File: `server/src/test/unit/components/ExperimentalFeaturesSettings.test.tsx`
- Validation: `npx vitest run server/src/test/unit/components/ExperimentalFeaturesSettings.test.tsx`
- Next test item: T018 Save button shows success feedback after saving

### 2026-01-24 (cont.)
- Implemented T018 (unit test):
  - Verifies save triggers a success toast (prompting the user to reload to apply changes).
  - File: `server/src/test/unit/components/ExperimentalFeaturesSettings.test.tsx`
- Validation: `npx vitest run server/src/test/unit/components/ExperimentalFeaturesSettings.test.tsx`
- Next test item: T019 Quick Ask shortcut (⌘↑) is ignored when aiAssistant is disabled

### 2026-01-24 (cont.)
- Implemented T019 (unit test):
  - Verifies ⌘↑/Ctrl↑ keydown is ignored (no preventDefault, overlay stays unrendered) when `aiAssistant` is disabled.
  - File: `server/src/test/unit/layout/DefaultLayout.quickAskShortcut.test.tsx`
- Validation: `npx vitest run server/src/test/unit/layout/DefaultLayout.quickAskShortcut.test.tsx`
- Next test item: T020 Quick Ask shortcut (⌘↑) works when aiAssistant is enabled

### 2026-01-24 (cont.)
- Implemented T020 (unit test):
  - Verifies ⌘↑ keydown `preventDefault()` is called and `QuickAskOverlay` opens when `aiAssistant` is enabled.
  - File: `server/src/test/unit/layout/DefaultLayout.quickAskShortcut.test.tsx`
- Validation: `npx vitest run server/src/test/unit/layout/DefaultLayout.quickAskShortcut.test.tsx`
- Next test item: T021 QuickAskOverlay is not rendered when aiAssistant is disabled

### 2026-01-24 (cont.)
- Implemented T021 (unit test):
  - Verifies `DefaultLayout` does not render `QuickAskOverlay` at all when `aiAssistant` is disabled (even before any shortcut is pressed).
  - File: `server/src/test/unit/layout/DefaultLayout.quickAskShortcut.test.tsx`
- Validation: `npx vitest run server/src/test/unit/layout/DefaultLayout.quickAskShortcut.test.tsx`
- Next test item: T022 QuickAskOverlay is rendered when aiAssistant is enabled

### 2026-01-24 (cont.)
- Implemented T022 (unit test):
  - Verifies `DefaultLayout` renders `QuickAskOverlay` (closed) when `aiAssistant` is enabled, without needing the shortcut.
  - File: `server/src/test/unit/layout/DefaultLayout.quickAskShortcut.test.tsx`
- Next test item: T023 Sidebar Chat toggle (⌘L) is ignored when aiAssistant is disabled

### 2026-01-24 (cont.)
- Implemented T023 (unit test):
  - Verifies ⌘L/Ctrl+L keydown is ignored (no preventDefault) when `aiAssistant` is disabled.
  - File: `server/src/test/unit/layout/DefaultLayout.sidebarChatShortcut.test.tsx`
- Validation: `npx vitest run server/src/test/unit/layout/DefaultLayout.sidebarChatShortcut.test.tsx`
- Next test item: T024 RightSidebar chat is hidden when aiAssistant is disabled

### 2026-01-24 (cont.)
- Implemented T024 (unit test):
  - Verifies `DefaultLayout` does not render `RightSidebar` when `aiAssistant` is disabled.
  - File: `server/src/test/unit/layout/DefaultLayout.sidebarChatShortcut.test.tsx`
- Validation: `npx vitest run server/src/test/unit/layout/DefaultLayout.sidebarChatShortcut.test.tsx`
- Next test item: T025 Sidebar Chat works normally when aiAssistant is enabled

### 2026-01-24 (cont.)
- Implemented T025 (unit test):
  - Verifies `DefaultLayout` renders `RightSidebar` when `aiAssistant` is enabled and that ⌘L/Ctrl+L toggles it open/closed (with `preventDefault()`).
  - File: `server/src/test/unit/layout/DefaultLayout.sidebarChatShortcut.test.tsx`
- Validation: `npx vitest run server/src/test/unit/layout/DefaultLayout.sidebarChatShortcut.test.tsx`
- Next test item: T026 /api/chat/v1/completions returns 403 when aiAssistant is disabled

### 2026-01-24 (cont.)
- Implemented T026 (unit test):
  - Verifies `/api/chat/v1/completions` returns 403 + JSON error when `aiAssistant` is disabled.
  - File: `server/src/test/unit/api/chatCompletions.route.gating.test.ts`
  - Added Vitest alias stub for `@product/chat/entry` so Next route modules can be imported in tests.
    - Files: `server/vitest.config.ts`, `server/src/test/stubs/product-chat-entry.ts`
- Validation: `npx vitest run server/src/test/unit/api/chatCompletions.route.gating.test.ts`
- Next test item: T027 /api/chat/v1/completions returns 200 when aiAssistant is enabled

### 2026-01-24 (cont.)
- Implemented T027 (unit test):
  - Verifies `/api/chat/v1/completions` returns 200 when `aiAssistant` is enabled and delegates to `ChatCompletionsService.handleRequest()`.
  - File: `server/src/test/unit/api/chatCompletions.route.gating.test.ts`
- Validation: `npx vitest run server/src/test/unit/api/chatCompletions.route.gating.test.ts`
- Next test item: T028 /api/chat/v1/execute returns 403 when aiAssistant is disabled

### 2026-01-24 (cont.)
- Implemented T028 (unit test):
  - Verifies `/api/chat/v1/execute` returns 403 + JSON error when `aiAssistant` is disabled.
  - File: `server/src/test/unit/api/chatExecute.route.gating.test.ts`
- Validation: `npx vitest run server/src/test/unit/api/chatExecute.route.gating.test.ts`
- Next test item: T029 /api/chat/stream/* returns 403 when aiAssistant is disabled

### 2026-01-24 (cont.)
- Implemented T029 (unit test):
  - Verifies `/api/chat/stream/title` and `/api/chat/stream/[...slug]` return 403 + JSON error when `aiAssistant` is disabled.
  - File: `server/src/test/unit/api/chatStream.route.gating.test.ts`
- Validation: `npx vitest run server/src/test/unit/api/chatStream.route.gating.test.ts`
- Next test item: T030 /api/chat/v1/completions/stream endpoint exists and accepts POST

### 2026-01-24 (cont.)
- Implemented T030 (unit test):
  - Verifies `/api/chat/v1/completions/stream` exports `POST` and returns a 200 response for a valid POST request when `aiAssistant` is enabled.
  - File: `server/src/test/unit/api/chatCompletionsStream.route.exists.test.ts`
- Validation: `npx vitest run server/src/test/unit/api/chatCompletionsStream.route.exists.test.ts`
- Next test item: T031 /api/chat/v1/completions/stream returns Content-Type: text/event-stream

### 2026-01-24 (cont.)
- Implemented T031 (unit test):
  - Verifies `/api/chat/v1/completions/stream` responds with `Content-Type: text/event-stream` (allows charset suffix).
  - File: `server/src/test/unit/api/chatCompletionsStream.route.exists.test.ts`
- Validation: `npx vitest run server/src/test/unit/api/chatCompletionsStream.route.exists.test.ts`
- Next test item: T032 Streaming endpoint passes stream: true to OpenRouter API

### 2026-01-24 (cont.)
- Implemented T032 (unit test):
  - Verifies `ChatCompletionsService.createRawCompletionStream()` passes `stream: true` into the OpenAI/OpenRouter SDK call.
  - File: `server/src/test/unit/services/chatCompletionsService.streaming.test.ts`
  - Note: Added Vitest path aliases for `@alga-psa/users` so EE service modules can be imported in unit tests.
    - File: `server/vitest.config.ts`
- Validation: `npx vitest run server/src/test/unit/services/chatCompletionsService.streaming.test.ts`
- Next test item: T033 Streaming response chunks follow SSE format with data: prefix

### 2026-01-24 (cont.)
- Implemented T033 (unit test):
  - Verifies `/api/chat/v1/completions/stream` emits SSE events that start with `data: ` (SSE framing) when tokens are streamed.
  - File: `server/src/test/unit/api/chatCompletionsStream.route.exists.test.ts`
- Validation: `npx vitest run server/src/test/unit/api/chatCompletionsStream.route.exists.test.ts`
- Next test item: T034 Each SSE chunk contains JSON with content and done fields

### 2026-01-24 (cont.)
- Implemented T034 (unit test):
  - Verifies each SSE `data:` event is valid JSON containing `content` (string) and `done` (boolean).
  - File: `server/src/test/unit/api/chatCompletionsStream.route.exists.test.ts`
- Validation: `npx vitest run server/src/test/unit/api/chatCompletionsStream.route.exists.test.ts`
- Next test item: T035 Final SSE message has done: true

### 2026-01-24 (cont.)
- Implemented T035 (unit test):
  - Verifies the streaming completions endpoint finishes with a final SSE event `{ content: "", done: true }` (and prior events are `done:false`).
  - File: `server/src/test/unit/api/chatCompletionsStream.route.exists.test.ts`
- Validation: `npx vitest run server/src/test/unit/api/chatCompletionsStream.route.exists.test.ts`
- Next test item: T036 Chat.tsx uses streaming endpoint for new messages

### 2026-01-24 (cont.)
- Implemented T036 (unit test):
  - Verifies EE `Chat.tsx` targets `/api/chat/v1/completions/stream` (and not `/api/chat/v1/completions`) and posts `messages: conversationWithUser`.
  - Uses `?raw` source import to avoid executing the Next.js client component in Vitest.
  - File: `server/src/test/unit/Chat.streamingEndpoint.test.ts`
- Validation: `npx vitest run server/src/test/unit/Chat.streamingEndpoint.test.ts`
- Next test item: T037 Chat.tsx reads streaming response via getReader()

### 2026-01-24 (cont.)
- Implemented T037 (unit test):
  - Verifies EE `Chat.tsx` reads the streaming response via `response.body.getReader()` and `await reader.read()`.
  - File: `server/src/test/unit/Chat.streamingEndpoint.test.ts`
- Validation: `npx vitest run server/src/test/unit/Chat.streamingEndpoint.test.ts`
- Next test item: T038 Tokens are appended to message display as they arrive

### 2026-01-24 (cont.)
- Implemented T038 (unit test):
  - Verifies SSE token chunks are appended incrementally (per-chunk) by `readAssistantContentFromSse()` via the `onToken` callback.
  - Files: `server/src/test/unit/readAssistantContentFromSse.test.ts`, `ee/server/src/components/chat/readAssistantContentFromSse.ts`, `ee/server/src/components/chat/Chat.tsx`
- Validation: `npx vitest run server/src/test/unit/readAssistantContentFromSse.test.ts`
- Next test item: T039 Message state updates incrementally during streaming

### 2026-01-24 (cont.)
- Implemented T039 (unit test):
  - Renders EE `Chat` and drives a controlled SSE `Response` to verify the in-progress assistant message updates as tokens arrive.
  - File: `server/src/test/unit/Chat.streamingIncrementalState.test.tsx`
  - Added EE component entrypoint shims to re-export from the `.tsx` source so Vitest can import `@ee/components/chat/Chat` and `@ee/components/message/Message` cleanly.
  - Files: `ee/server/src/components/chat/Chat.js`, `ee/server/src/components/message/Message.js`
- Validation: `npx vitest run server/src/test/unit/Chat.streamingIncrementalState.test.tsx`
- Next test item: T040 Stop button triggers AbortController.abort() during streaming

### 2026-01-24 (cont.)
- Implemented T040 (unit test):
  - Verifies clicking `STOP` during an active streaming request calls `AbortController.abort()`.
  - File: `server/src/test/unit/Chat.streamingIncrementalState.test.tsx`
- Validation: `npx vitest run server/src/test/unit/Chat.streamingIncrementalState.test.tsx`
- Next test item: T041 Aborting stream stops token display and ends generation state

### 2026-01-24 (cont.)
- Implemented T041 (unit test):
  - Verifies clicking `STOP` ends generating state (button returns to `SEND`, input enabled) and prevents additional streamed tokens from updating the message display.
  - File: `server/src/test/unit/Chat.streamingIncrementalState.test.tsx`
- Validation: `npx vitest run server/src/test/unit/Chat.streamingIncrementalState.test.tsx`
- Next test item: T042 Streaming indicator is visible while receiving tokens

### 2026-01-24 (cont.)
- Implemented T042 (unit test):
  - Verifies the assistant message shows the streaming cursor (`.message-streaming-cursor`) after the first streamed token arrives.
  - File: `server/src/test/unit/Chat.streamingIncrementalState.test.tsx`
- Validation: `npx vitest run server/src/test/unit/Chat.streamingIncrementalState.test.tsx`
- Next test item: T043 Streaming indicator disappears when done: true received

### 2026-01-24 (cont.)
- Implemented T043 (unit test):
  - Verifies the streaming cursor is removed after the final SSE `{ done: true }` event is received.
  - File: `server/src/test/unit/Chat.streamingIncrementalState.test.tsx`
- Validation: `npx vitest run server/src/test/unit/Chat.streamingIncrementalState.test.tsx`
- Next test item: T044 Network error during streaming shows partial response

### 2026-01-24 (cont.)
- Implemented T044 (unit test):
  - Verifies a mid-stream read error results in an `Interrupted` assistant message with the partial content preserved.
  - File: `server/src/test/unit/Chat.streamingIncrementalState.test.tsx`
- Validation: `npx vitest run server/src/test/unit/Chat.streamingIncrementalState.test.tsx`
- Next test item: T045 Stream interruption shows error indicator on message

### 2026-01-24 (cont.)
- Implemented T045 (unit test):
  - Verifies a stream that ends without a `{ done: true }` event shows the `Interrupted` badge and keeps the partial text.
  - File: `server/src/test/unit/Chat.streamingIncrementalState.test.tsx`
- Validation: `npx vitest run server/src/test/unit/Chat.streamingIncrementalState.test.tsx`
- Next test item: T046 Assistant message is persisted after streaming completes successfully
