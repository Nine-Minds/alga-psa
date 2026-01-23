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
- Next feature item: F003 `isExperimentalFeatureEnabled(featureKey)`
