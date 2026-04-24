# Scratchpad

## 2026-04-24

- Confirmed MSP SSO domain revocation is not the right fix for Microsoft 365 inbound email OAuth.
- `revokeMspSsoDomainClaim` sets `claim_status = 'revoked'` but leaves `is_active = true`; MSP SSO discovery still treats revoked EE claims as ineligible and falls back to app-level SSO providers.
- Microsoft inbound email uses `resolveMicrosoftConsumerProfileConfig(tenant, 'email')` in OAuth initiation, callback, and token refresh.
- Current resolver returns `not_configured` when no Email binding exists, so the included hosted/Nine Minds Microsoft email OAuth app is never used by the active server-action path.
- Decision: add hosted app-level fallback inside the shared integrations resolver for `consumerType === 'email'` only when no explicit binding exists. Do not fallback for invalid explicit bindings.
- Additional discovery: `initiateEmailOAuth` validates a provider after the form creates the `email_providers` row. The legacy binding migration could interpret that just-created row as legacy usage and auto-bind Email to the tenant's only Microsoft profile. To avoid forcing tenants onto an SSO-oriented app, Email binding migration now requires legacy tenant Microsoft client credentials, not just a Microsoft email provider row.

Key files:
- `packages/integrations/src/lib/microsoftConsumerProfileResolution.ts`
- `packages/integrations/src/actions/integrations/microsoftActions.ts`
- `packages/integrations/src/actions/email-actions/oauthActions.ts`
- `server/src/app/api/auth/microsoft/callback/route.ts`
- `server/src/services/email/providers/MicrosoftGraphAdapter.ts`
- `packages/integrations/src/lib/microsoftConsumerProfileResolution.test.ts`
- `server/src/test/unit/microsoft/microsoftConsumerRuntimeResolution.contract.test.ts`

Validation:
- PASS: `cd server && npx vitest run --coverage.enabled=false ../packages/integrations/src/lib/microsoftConsumerProfileResolution.test.ts`
- PASS with warnings only: `npx eslint packages/integrations/src/lib/microsoftConsumerProfileResolution.ts packages/integrations/src/lib/microsoftConsumerProfileResolution.test.ts packages/integrations/src/actions/integrations/microsoftActions.ts`
- Existing unrelated failures observed when running broader suites:
  - `server/src/test/unit/microsoft/microsoftConsumerRuntimeResolution.contract.test.ts` expects calendar EE action implementation in `packages/ee/src/lib/actions/integrations/calendarActions.ts`, but this branch currently has a CE stub export there.
  - `packages/integrations/src/actions/integrations/microsoftActions.test.ts` has edition-visibility failures in this environment where `isEnterprise` is statically resolved rather than following per-test `NEXT_PUBLIC_EDITION` changes.
