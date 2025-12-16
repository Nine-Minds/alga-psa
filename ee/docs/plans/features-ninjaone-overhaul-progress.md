# NinjaOne Per-Tenant Credentials - Progress Tracker

## Overview

Switch NinjaOne integration from centralized OAuth app credentials to per-tenant configuration where each tenant provides their own NinjaOne API Client ID and Client Secret.

**Branch:** `feat/ninjaone-custom-credentials`
**Started:** 2024-12-16

---

## Progress Summary

| Category | Completed | Total |
|----------|-----------|-------|
| Server Actions | 0 | 3 |
| OAuth Connect Route | 0 | 3 |
| OAuth Callback Route | 0 | 3 |
| Setup UI | 0 | 11 |
| Testing | 0 | 3 |
| **Total** | **0** | **23** |

---

## Detailed Progress

### Server Actions (`ninjaoneActions.ts`)

- [ ] Add `saveNinjaOneCredentials()` action
- [ ] Add `getNinjaOneCredentialsStatus()` action
- [ ] Update `disconnectNinjaOneIntegration()` to clear credentials

### OAuth Connect Route (`connect/route.ts`)

- [ ] Change credential retrieval from `getAppSecret` to `getTenantSecret`
- [ ] Remove environment variable fallback
- [ ] Add proper error redirect when credentials not configured

### OAuth Callback Route (`callback/route.ts`)

- [ ] Change credential retrieval from `getAppSecret` to `getTenantSecret`
- [ ] Remove environment variable fallback
- [ ] Add proper error handling when credentials not found

### Setup UI (`NinjaOneIntegrationSettings.tsx`)

- [ ] Add state variables for credentials management
- [ ] Add setup instructions card
- [ ] Add external link to NinjaOne API settings
- [ ] Add Client ID input field
- [ ] Add Client Secret input field with show/hide toggle
- [ ] Add Save Credentials button
- [ ] Display dynamic redirect URI
- [ ] Enable Connect button when credentials saved
- [ ] Remove "waiting for approval" message
- [ ] Load credential status on mount
- [ ] Show saved credentials status

### Testing

- [ ] Test end-to-end OAuth flow
- [ ] Test credential save/load/clear
- [ ] Test disconnect clears credentials

---

## Work Log

### 2024-12-16

- Created feature branch `feat/ninjaone-custom-credentials` from `release/0.15.0`
- Created implementation plan
- Created tracking files (`features-ninjaone-overhaul.json`, `features-ninjaone-overhaul-progress.md`)

---

## Files Modified

| File | Status | Notes |
|------|--------|-------|
| `ee/server/src/lib/actions/integrations/ninjaoneActions.ts` | Pending | Add credential management actions |
| `ee/server/src/app/api/integrations/ninjaone/connect/route.ts` | Pending | Use tenant secrets |
| `ee/server/src/app/api/integrations/ninjaone/callback/route.ts` | Pending | Use tenant secrets |
| `ee/server/src/components/settings/integrations/NinjaOneIntegrationSettings.tsx` | Pending | Add credential input UI |

---

## Notes

- Environment variable fallback will be completely removed
- Client Secret stored encrypted via secrets provider
- Redirect URI format: `{APP_BASE_URL}/api/integrations/ninjaone/callback`
