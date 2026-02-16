# Mobile Rollout Checklist + Rollback Plan

Scope: Ticketing MVP + SSO (hosted only), `mobile/` + supporting server endpoints.

Last updated: 2026-02-03

## Rollout Checklist

### Pre-release

- [ ] Server: mobile auth endpoints enabled behind a feature/config flag per environment.
- [ ] Server: hosted domain allowlist configured (if used) and includes the production domain(s).
- [ ] Server: token TTLs/rotation configured; revocation works.
- [ ] Server: RBAC verified for ticket list/detail/comments/mutations (401/403 behavior).
- [ ] Mobile: analytics enabled/disabled default confirmed; no PII in event properties.
- [ ] Mobile: crash reporting provider configured (or explicitly disabled); request/response bodies excluded.
- [ ] Mobile: privacy policy + terms URLs reachable from Settings.
- [ ] Mobile: accessibility smoke pass (VoiceOver/TalkBack basics, touch targets, labels).

### Distribution

- [ ] iOS: App Store Connect app created and bundle id matches `mobile/app.json`.
- [ ] iOS: TestFlight internal group configured.
- [ ] Android: Play Console app created and package name matches `mobile/app.json`.
- [ ] Android: Internal testing track configured.
- [ ] CI secrets configured (`EXPO_TOKEN`, plus any EAS submit credentials).
- [ ] Run `.github/workflows/mobile-distribute.yml`:
  - `testflight`
  - `playInternal`

### Monitoring / Support

- [ ] Dashboards for auth success/failure and API error rates.
- [ ] Support escalation path documented for “can’t sign in” and “401 loop” issues.
- [ ] Known issues doc prepared for beta testers.

## Rollback Plan

### Immediate mitigation (minutes)

- Disable mobile auth capability flag server-side (capabilities endpoint returns `mobileEnabled:false`).
- Revoke/expire refresh tokens for affected tenant(s) if compromise is suspected.
- Communicate status to testers and support.

### Store rollback (hours)

- iOS: stop TestFlight external testing / expire builds if needed.
- Android: deactivate the release in the internal track / roll back to previous version if available.

### Follow-up (days)

- Root-cause analysis with logs/metrics for auth failures, 401/403 spikes, and API error rates.
- Patch + re-release with incremented build numbers and updated release notes.

