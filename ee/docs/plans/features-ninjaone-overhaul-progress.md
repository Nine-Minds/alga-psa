# NinjaOne Per-Tenant Credentials - Progress Tracker

## Overview

Switch NinjaOne integration from centralized OAuth app credentials to per-tenant configuration where each tenant provides their own NinjaOne API Client ID and Client Secret.

**Branch:** `feat/ninjaone-custom-credentials`
**Started:** 2024-12-16

---

## Progress Summary

| Category | Completed | Total |
|----------|-----------|-------|
| Server Actions | 3 | 3 |
| OAuth Connect Route | 3 | 3 |
| OAuth Callback Route | 3 | 3 |
| Setup UI | 11 | 11 |
| Testing | 0 | 3 |
| **Total** | **20** | **23** |

---

## Detailed Progress

### Server Actions (`ninjaoneActions.ts`)

- [x] Add `saveNinjaOneCredentials()` action
- [x] Add `getNinjaOneCredentialsStatus()` action
- [x] Update `disconnectNinjaOneIntegration()` to clear credentials

### OAuth Connect Route (`connect/route.ts`)

- [x] Change credential retrieval from `getAppSecret` to `getTenantSecret`
- [x] Remove environment variable fallback
- [x] Add proper error redirect when credentials not configured

### OAuth Callback Route (`callback/route.ts`)

- [x] Change credential retrieval from `getAppSecret` to `getTenantSecret`
- [x] Remove environment variable fallback
- [x] Add proper error handling when credentials not found

### Setup UI (`NinjaOneIntegrationSettings.tsx`)

- [x] Add state variables for credentials management
- [x] Add setup instructions card
- [x] Add external link to NinjaOne API settings
- [x] Add Client ID input field
- [x] Add Client Secret input field with show/hide toggle
- [x] Add Save Credentials button
- [x] Display dynamic redirect URI
- [x] Enable Connect button when credentials saved
- [x] Remove "waiting for approval" message
- [x] Load credential status on mount
- [x] Show saved credentials status

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
- Implemented server actions (`saveNinjaOneCredentials`, `getNinjaOneCredentialsStatus`, `clearNinjaOneCredentials`)
- Updated `disconnectNinjaOneIntegration` to clear client credentials
- Updated connect route to use tenant secrets instead of app secrets
- Updated callback route to use tenant secrets instead of app secrets
- Added complete credential input UI with setup instructions, input fields, and saved status display
- Enabled Connect button conditionally based on credential status
- Removed "waiting for approval" message

---

## Files Modified

| File | Status | Notes |
|------|--------|-------|
| `ee/server/src/lib/actions/integrations/ninjaoneActions.ts` | Complete | Added credential management actions |
| `ee/server/src/app/api/integrations/ninjaone/connect/route.ts` | Complete | Uses tenant secrets |
| `ee/server/src/app/api/integrations/ninjaone/callback/route.ts` | Complete | Uses tenant secrets |
| `ee/server/src/components/settings/integrations/NinjaOneIntegrationSettings.tsx` | Complete | Added credential input UI |

---

## Notes

- Environment variable fallback has been completely removed
- Client Secret stored encrypted via secrets provider
- Redirect URI format: `{APP_BASE_URL}/api/integrations/ninjaone/callback`
- Disconnect now clears client credentials (Client ID and Client Secret) in addition to OAuth tokens
