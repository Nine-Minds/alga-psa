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
