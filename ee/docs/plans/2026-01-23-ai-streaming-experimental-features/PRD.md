# AI Streaming + Experimental Features Settings

## Summary

This plan covers two related improvements:

1. **True Streaming for AI Chat**: Replace the simulated "typing reveal" effect with real token-by-token SSE streaming from OpenRouter, providing faster perceived response times and a more natural chat experience.

2. **Experimental Features Settings**: Add a new "Experimental Features" tab to General Settings that allows tenants to toggle experimental features on/off. The first experimental feature will be **AI Assistant**, which gates access to both the Quick Ask overlay and the sidebar chat.

## Problem Statement

### Streaming
The current AI chat implementation receives the full response from OpenRouter before displaying anything, then simulates streaming with a typewriter effect. This creates unnecessary latency—users wait for the entire response before seeing any output.

### Experimental Features Gating
AI features are currently gated only at the edition level (Enterprise Edition). There's no tenant-level control, meaning all EE tenants have AI enabled whether they want it or not. Some tenants may:
- Prefer to evaluate AI features before enabling them for their team
- Have compliance concerns about AI
- Want to reduce UI complexity by hiding unused features

## Goals

1. Implement true SSE token streaming for AI chat responses
2. Create an "Experimental Features" settings screen
3. Gate AI Assistant (Quick Ask + Sidebar Chat) behind a tenant-level experimental feature toggle
4. Default experimental features to **disabled** for all tenants

## Non-Goals

- A/B testing infrastructure
- Per-user experimental feature toggles (tenant-level only)
- Streaming for function call results (text responses only)
- Gradual rollout percentages

## Users / Personas

- **Tenant Admin**: Configures which experimental features are enabled for their organization
- **All Users**: Experience streaming responses when AI is enabled; see AI features hidden when disabled

## Primary User Flows

### Flow A: Admin Enables AI Assistant
1. Admin navigates to Settings → Experimental Features
2. Admin sees list of experimental features with toggles (all off by default)
3. Admin toggles "AI Assistant" to enabled
4. Admin clicks Save
5. After page reload, all users in the tenant can use Quick Ask (⌘↑) and Sidebar Chat (⌘L)

### Flow B: User Experiences Streaming
1. User opens Quick Ask or Sidebar Chat
2. User sends a message
3. Response tokens appear incrementally as they're generated
4. User can stop generation mid-stream if desired

### Flow C: User with AI Disabled
1. User presses ⌘↑ (Quick Ask shortcut)
2. Nothing happens (shortcut is disabled when AI Assistant is off)
3. Sidebar chat button is also hidden/disabled

## UX/UI Notes

### Experimental Features Settings Tab
- New tab in Settings page: "Experimental Features"
- Simple list view with:
  - Feature name and description
  - Toggle switch for each feature
  - Save button at bottom
- Warning banner: "Experimental features may change or be removed without notice."

### Feature List (Initial)
| Feature | Description | Default |
|---------|-------------|---------|
| AI Assistant | Enable AI-powered Quick Ask and Chat sidebar | Off |

### Streaming UX
- Response text appears token-by-token as received
- Cursor/indicator shows generation is in progress
- Stop button remains functional during streaming
- If connection drops, display partial response with error indicator

## Technical Design Notes

### Experimental Features Storage

**Location**: `tenant_settings.settings.experimentalFeatures` (JSONB)

Schema within JSONB:
```json
{
  "experimentalFeatures": {
    "aiAssistant": false
  }
}
```

**Rationale**: The `tenant_settings.settings` JSONB column already exists and follows the pattern used for analytics settings. No schema migration required—just add keys to the JSON structure.

### Server Actions (New)

Add to `/packages/tenancy/src/actions/tenant-settings-actions/tenantSettingsActions.ts`:

```typescript
export async function getExperimentalFeatures(): Promise<ExperimentalFeatures>
export async function updateExperimentalFeatures(features: Partial<ExperimentalFeatures>): Promise<void>
export async function isExperimentalFeatureEnabled(featureKey: string): Promise<boolean>
```

**Permission**: Reuse existing `settings:update` permission for updating experimental features.

### UI Gating

**Quick Ask**: In `DefaultLayout.tsx`, check `isExperimentalFeatureEnabled('aiAssistant')` before:
- Registering the ⌘↑ keyboard shortcut
- Rendering the `QuickAskOverlay` component

**Sidebar Chat**: In `RightSidebarContent.tsx` or `RightSidebar.tsx`:
- Check feature flag before rendering chat
- Optionally hide the chat toggle button in header

### Streaming Implementation

**Backend Changes** (`chatCompletionsService.ts`):
1. Add `stream: true` option to OpenRouter API call
2. Return a `ReadableStream` instead of JSON response
3. Format as SSE: `data: {"content": "token", "done": false}\n\n`
4. Send `data: {"content": "", "done": true}\n\n` on completion

**New Streaming Endpoint**: `/api/chat/v1/completions/stream`
- Accepts same payload as `/api/chat/v1/completions`
- Returns SSE stream instead of JSON

**Frontend Changes** (`Chat.tsx`):
1. Use `fetch()` with streaming response handling
2. Read chunks via `response.body.getReader()`
3. Parse SSE format and append tokens to message state
4. Handle abort via `AbortController`

### API Gating

Add tenant feature check to chat API routes:
- `/api/chat/v1/completions` - Check `aiAssistant` enabled
- `/api/chat/v1/execute` - Check `aiAssistant` enabled
- `/api/chat/stream/*` - Check `aiAssistant` enabled

Return 403 with message "AI Assistant is not enabled for this tenant" if disabled.

## Risks / Edge Cases

1. **Streaming interruption**: Network drops mid-stream → Show partial response with "interrupted" indicator
2. **Permission check latency**: Feature check on every API call → Cache tenant settings briefly (already done in tenant context)
3. **Migration for existing tenants**: All tenants default to AI disabled → May need communication/docs

## Acceptance Criteria / Definition of Done

### Streaming
- [ ] AI responses stream token-by-token in Quick Ask
- [ ] AI responses stream token-by-token in Sidebar Chat
- [ ] Stop button works during streaming to cancel generation
- [ ] Partial responses are displayed if stream is interrupted
- [ ] Streaming persists final message to database correctly

### Experimental Features Settings
- [ ] "Experimental Features" tab appears in Settings
- [ ] AI Assistant toggle is present and defaults to off
- [ ] Saving toggle updates tenant_settings in database
- [ ] Toggle state persists across page refreshes

### AI Gating
- [ ] Quick Ask shortcut (⌘↑) does nothing when AI Assistant is disabled
- [ ] Sidebar Chat is hidden/disabled when AI Assistant is disabled
- [ ] Chat API endpoints return 403 when AI Assistant is disabled
- [ ] Enabling AI Assistant enables Quick Ask and Chat after page reload
