# Provider Setup Order (Google + Microsoft)

Use this order for all CE/EE environments:

1. Open `Settings -> Integrations -> Providers`.
2. Configure provider credentials first:
   - Google: `google_client_id`, `google_client_secret`
   - Microsoft: `microsoft_client_id`, `microsoft_client_secret`, optional `microsoft_tenant_id` (`common` default)
3. Save provider settings.
4. After provider settings are ready, configure integration-level connections:
   - `Settings -> Integrations -> Communication` (Inbound Email)
   - `Settings -> Integrations -> Calendar` (Calendar Sync)
5. Run OAuth connect/authorize from the integration forms.

Notes:
- Microsoft and Google integration forms no longer require per-form client ID/client secret entry in CE.
- MSP login SSO can use tenant provider credentials first, and app-level `*_OAUTH_*` values only as fallback.
