# Mobile Security Review (Pre-release)

Date: `2026-02-03`  
Scope: Mobile Ticketing MVP + mobile auth endpoints

## Checklist

### Authentication & session handling

- [x] Uses system browser for SSO (no embedded webview credential entry).
- [x] Uses short-lived access token + refresh token rotation for mobile API access.
- [x] Stores secrets in OS secure storage (Keychain/Keystore via `expo-secure-store`).
- [x] Supports server-side logout (refresh token revocation + access token deactivation).

### Token safety / leakage prevention

- [x] Logging redacts tokens and other secrets (`authorization`, refresh/access tokens, OTT, state).
- [x] Crash/error reporting omits HTTP bodies by default.
- [x] Clipboard helper redacts sensitive values by default.

### Deep links / redirects

- [x] Deep link handler validates allowed schemes/prefixes and rejects unexpected paths.
- [x] OTT exchange validates `state` and enforces single-use + short TTL.
- [x] OTT is bound to the web session id to prevent cross-session replay.

### Authorization / RBAC

- [x] Mobile API calls use server-side permission checks (no client-side bypass).
- [x] 403/no-access UX is explicit to avoid confusing failures.

### Rate limiting / abuse

- [x] OTT issue/exchange/refresh are rate limited (per IP and per user).

## Follow-ups

- Re-run this checklist before external beta if auth flows or token storage change.

