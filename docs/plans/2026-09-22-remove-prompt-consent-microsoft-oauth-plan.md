# Remove forced Microsoft OAuth consent

Microsoft mailbox connections currently force consent even when an administrator has already granted the requested permissions. Replace the Microsoft email helpers' `prompt=consent` with `prompt=select_account`, matching `buildBootstrapAuthorizationUrl` in `packages/integrations/src/actions/integrations/microsoftEmailSetupActions.ts:146`. Keep `offline_access` and all other request parameters unchanged.

Microsoft documents that `select_account` requests account selection and that the authorization-code flow returns refresh tokens when `offline_access` is requested. Consent remains subject to existing grants and tenant policy; account selection is not a consent screen. See [Microsoft authorization-code flow](https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-auth-code-flow).

## Verified files and edits

Line numbers below refer to the code inspected on 2026-09-22.

| File | Planned edit |
| --- | --- |
| `packages/integrations/src/utils/email/oauthHelpers.ts:46` | In `generateMicrosoftAuthUrl`, replace `prompt: 'consent'` with `prompt: 'select_account'`. Replace the misleading refresh-token comment with `// Select an account without forcing consent; offline_access requests a refresh token.` Leave Google's line 74 unchanged. |
| `server/src/utils/email/oauthHelpers.ts:41` | Apply the same Microsoft parameter and comment change. Line 69 belongs to Google and stays unchanged. |
| `packages/integrations/src/utils/email/oauthHelpers.test.ts:25` | Expect `select_account` instead of `consent`; retain the complete scope assertion, including `offline_access`. |
| `server/src/test/unit/email/microsoftOutboundOAuth.contract.test.ts` | Add a `prompt === 'select_account'` assertion to the existing legacy-helper test; retain its scope and URL assertions. |
| `packages/integrations/src/utils/calendar/oauthHelpers.ts` | No edit. Line 25 is Google consent. Microsoft already uses `select_account` at line 52 and includes `offline_access`. |
| `ee/packages/calendar/src/lib/utils/calendar/oauthHelpers.ts` | No edit. Line 22 is Google consent. Microsoft already uses `select_account` at line 46 and includes `offline_access`. |
| `server/src/utils/calendar/oauthHelpers.ts` | No edit. Line 24 is Google consent. Microsoft already uses `select_account` at line 51 and includes `offline_access`. |

The legacy email module is still referenced: the HTTP email initiate route imports its Google helper and nonce/state utilities; the IMAP initiate/callback routes import its state utilities. Its Microsoft URL builder has a caller in `server/src/test/unit/email/microsoftOutboundOAuth.contract.test.ts`, but no production caller was found. The HTTP initiate route explicitly rejects Microsoft; the supported mailbox flow uses `packages/integrations/src/actions/email-actions/oauthActions.ts:133` with signed state. Keep the legacy builder consistent without deleting or rerouting it.

Repository searches for consent parameters, Microsoft authorize endpoints, and helper references found no additional Microsoft-specific builder forcing consent. The package helper also serves `packages/integrations/src/actions/integrations/entraActions.ts:455` and `ee/server/src/lib/mcp/connectOAuth.ts:86`; they inherit account selection without caller edits. The bootstrap builder already uses the desired value.

`server/src/app/api/email/oauth/imap/initiate/route.ts:71` remains out of scope. It builds a URL from provider-configured endpoint/scopes and always sends consent. It can target Microsoft, but changing it globally could affect Google and other providers; a provider-aware change is not trivially safe.

## Validation and acceptance

1. Run the existing package helper suite after updating its expectation: from `packages/integrations`, run `npx vitest run src/utils/email/oauthHelpers.test.ts`. Run the existing `src/actions/email-actions/oauthActions.test.ts` and `src/actions/integrations/microsoftEmailSetupActions.test.ts` suites with the same package runner.
2. From `server`, run `npx vitest run src/test/unit/email/microsoftOutboundOAuth.contract.test.ts src/test/unit/integrations/entraActions.directConnect.test.ts`. Run the existing `ee/server/src/__tests__/unit/mcpConnectOAuth.test.ts` suite using its EE unit runner because that flow shares the changed helper. These are planned checks, not results from this design session.
3. Review generated mailbox and calendar authorize URLs: `prompt=select_account`, no `prompt=consent`, and `offline_access` retained. Recheck all three calendar copies and ensure Google consent/offline parameters are unchanged.
4. In a real Microsoft tenant with user consent disabled and admin consent granted for the selected app's complete requested scope set, connect a hosted mailbox as an ordinary user. Expect account selection, no consent screen or admin-approval loop, successful callback, and a stored refresh token. Repeat for Microsoft calendar with its required grants.
5. In a tenant lacking consent, verify Microsoft still requests consent/admin approval according to policy. Complete consent with an authorized administrator and verify connection succeeds. An ordinary user with consent disabled must not bypass approval.
6. Reconnect an existing mailbox provider and calendar provider. Verify successful code exchange returns and persists a fresh refresh token and that token refresh succeeds. Record success without recording token values.

## Boundaries and risks

No Google changes, generic IMAP changes, scope changes, state/callback/token-storage changes, helper consolidation, migrations, feature flags, or UI work. Preserve `MICROSOFT_EMAIL_OAUTH_SCOPES` in `shared/services/email/microsoftGraphEndpoints.ts:15`. This design deliverable does not implement, open a PR, merge, deploy, or send a customer reply. Customer follow-up remains due after merge/deployment is confirmed.

Account selection also affects Entra direct-connect and MCP callers of the package helper. Missing permissions, a grant for another application, and tenant access policies can still require approval or prevent connection. URL tests cannot prove real Entra consent or refresh-token behavior.

No open implementation decision remains. The validation dependency is access to test tenants/accounts covering existing admin consent, missing consent, and reconnect. If unavailable, report live acceptance as unverified rather than substituting emulator success. Generic Microsoft IMAP consent behavior remains a separate follow-up.
