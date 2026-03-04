# Provider Setup Order (Google + Microsoft)

Use this order for all CE/EE environments:

1. Open `Settings -> Integrations -> Providers`.
2. Configure provider credentials first:
   - Google: `google_client_id`, `google_client_secret`
   - Microsoft: `microsoft_client_id`, `microsoft_client_secret`, optional `microsoft_tenant_id` (`common` default)
3. Save provider settings.
4. Configure MSP SSO login domains for tenant discovery in `Settings -> Integrations -> Providers`:
   - Add one or more tenant-owned login domains (for example: `acme.com`).
   - Discovery uses these domains to map login email domain -> tenant provider configuration.
5. After provider settings and login domains are ready, configure integration-level connections:
   - `Settings -> Integrations -> Communication` (Inbound Email)
   - `Settings -> Integrations -> Calendar` (Calendar Sync)
6. Run OAuth connect/authorize from the integration forms.

Notes:
- Microsoft and Google integration forms no longer require per-form client ID/client secret entry in CE.
- MSP login SSO uses tenant-discovered provider credentials first.
- If a login email domain is unresolved (no mapping or ambiguous mapping), MSP login falls back to app-level `*_OAUTH_*` provider availability.
