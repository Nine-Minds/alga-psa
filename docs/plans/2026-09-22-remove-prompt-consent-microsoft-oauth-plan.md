# Remove forced consent from Microsoft mailbox OAuth

Design Session implementation plan, 2026-09-22. This deliverable is planning only.

## Problem and decision

A customer reports that the hosted Microsoft mailbox connection repeatedly requests admin approval despite an existing tenant-wide admin-consent grant and disabled user consent. Both email URL helpers force `prompt=consent` and incorrectly explain that it is required for a refresh token.

Change Microsoft email authorization requests to `prompt: 'select_account'`, matching the bootstrap builder in `packages/integrations/src/actions/integrations/microsoftEmailSetupActions.ts:146` and all three existing Microsoft calendar builders. Keep `offline_access` and every other request parameter intact. This retains explicit account choice while allowing Entra to determine whether consent is needed.

Microsoft documents that `consent` forces the consent dialog, `select_account` requests account selection, missing grants trigger consent, and refresh tokens require `offline_access`. See [Microsoft authorization code flow](https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-auth-code-flow). The reported enterprise-policy failure still requires validation against a real tenant; local URL tests cannot prove tenant-policy behavior.

## Verified scope and exact edits

Line references below describe the inspected checkout before implementation.

| File | Finding and implementation edit |
| --- | --- |
| `packages/integrations/src/utils/email/oauthHelpers.ts:46` | In `generateMicrosoftAuthUrl`, replace `prompt: 'consent'` with `prompt: 'select_account'`. Replace the incorrect refresh-token comment with `// Select an account without forcing consent; offline_access requests a refresh token.` Leave Google at line 74 unchanged. |
| `server/src/utils/email/oauthHelpers.ts:41` | Apply the identical Microsoft-only replacement and comment. Line 69 belongs to `generateGoogleAuthUrl`; preserve it. Retain the legacy module and its exports. |
| `packages/integrations/src/utils/email/oauthHelpers.test.ts:25` | Change the Microsoft expectation from `toBe('consent')` to `toBe('select_account')`. Retain the complete existing scope expectation, including `offline_access`. |
| `server/src/test/unit/email/microsoftOutboundOAuth.contract.test.ts:7` | Add `expect(authUrl.searchParams.get('prompt')).toBe('select_account')` to the existing URL contract case to cover the separately maintained legacy builder. Retain authority, redirect URI, and scope checks. |
| `packages/integrations/src/utils/calendar/oauthHelpers.ts:25` | No production edit. The cited line is **Google** Calendar and must keep `consent`. Microsoft already uses `select_account` at line 52 and includes `offline_access` at line 43. |
| `ee/packages/calendar/src/lib/utils/calendar/oauthHelpers.ts:22` | No production edit. The cited line is **Google** Calendar. Microsoft already uses `select_account` at line 46 and includes `offline_access` at line 37. |
| `server/src/utils/calendar/oauthHelpers.ts:24` | No production edit. The cited line is **Google** Calendar. Microsoft already uses `select_account` at line 51 and includes `offline_access` at line 42. |
| `shared/services/email/microsoftGraphEndpoints.ts:15` | No edit. Both email helpers default to `MICROSOFT_EMAIL_OAUTH_SCOPES`, which already includes `offline_access` at line 23. |
| `packages/integrations/src/actions/integrations/microsoftEmailSetupActions.ts:146` | No edit; existing `select_account` is the model. |
| `server/src/app/api/email/oauth/imap/initiate/route.ts:71` | Deliberately out of scope; retain `consent`. The endpoint takes an arbitrary configured authorization URL and scopes, and unconditionally includes Google-style `access_type: 'offline'`. Changing all providers or adding provider detection is not trivially safe within this Microsoft mailbox fix. |

Expected implementation diff: two helper files and two existing test files. Do not edit calendar production code just to touch the sites named in the brief.

## Reference and dependency audit

The legacy server email module is still referenced at runtime:

- `server/src/app/api/email/oauth/initiate/route.ts:4` imports Google URL generation, nonce generation, and the state type. Its Microsoft branch explicitly rejects requests; it does not call the legacy Microsoft builder.
- `server/src/app/api/email/oauth/imap/initiate/route.ts:5` imports state encoding, nonce generation, and the state type.
- `server/src/app/api/email/oauth/imap/callback/route.ts:3` imports state decoding and validation.
- `server/src/test/unit/email/microsoftOutboundOAuth.contract.test.ts:2` imports the legacy Microsoft builder directly. No runtime caller of that specific export was found. Updating it prevents the retained implementation from diverging; deleting or consolidating it is outside this fix.

The package Microsoft helper has these runtime consumers:

- `packages/integrations/src/actions/email-actions/oauthActions.ts:133,137`: mailbox initiation, including signed-state create/reconnect and hosted/tenant application selection. The prompt change must preserve the signed state verbatim.
- `packages/integrations/src/actions/integrations/entraActions.ts:455`: Entra direct connect with explicit delegated scopes.
- `ee/server/src/lib/mcp/connectOAuth.ts:86`: Microsoft MCP connect with its own scopes.

These callers inherit account selection. They pass the resulting URL onward and do not inspect or require `prompt=consent`. Missing grants must continue to invoke Microsoft's consent handling. Commented-out calls in `emailProviderActions.ts` are not active consumers.

Repository-wide searches for `prompt`, `prompt=consent`, `oauthHelpers`, `generateMicrosoftAuthUrl`, `generateMicrosoftCalendarAuthUrl`, Microsoft authorize endpoints, and `getMicrosoftAuthorizeUrl` found no additional explicit Microsoft URL builder forcing consent. The generic IMAP endpoint can be configured with Microsoft and remains the explicit exception. The only assertion found requiring Microsoft `consent` is the package helper test identified above; no runtime dependency on that value was found.

## Implementation and validation sequence

1. Make the four scoped edits above. Preserve Google consent settings, scopes, authority selection, redirect URIs, signed/unsigned state behavior, and token exchange/persistence code.
2. Run the existing package helper suite from `packages/integrations`: `npx vitest run src/utils/email/oauthHelpers.test.ts`.
3. Run the legacy contract suite from `server`: `npx vitest run src/test/unit/email/microsoftOutboundOAuth.contract.test.ts`. Use the repository's configured test environment; report environmental failures separately from assertion failures.
4. Inspect the complete diff and repeat the prompt/builder search. Confirm both Microsoft email builders now use `select_account`, all three Microsoft calendar builders retain it, and Google's email/calendar `consent` settings remain unchanged. Confirm `offline_access` remains in both email defaults and all calendar scope lists.
5. Exercise the live acceptance matrix below against configured test Microsoft applications/tenants. Existing calendar emulator coverage in `server/src/test/integration/microsoftCalendarEmulator.integration.test.ts` exercises shared and EE authorization/token exchange, but does not prove Entra consent policy and is not a substitute for live acceptance.

No new test infrastructure, schema migrations, refactoring, or feature flag is needed. Tests are planned here, not executed during the Design Session.

## Acceptance checks

| Scenario | Expected evidence |
| --- | --- |
| Microsoft mailbox connect and calendar connect | Inspect generated authorize URLs: `prompt=select_account`, never `prompt=consent`; `offline_access` remains present. Cover the hosted mailbox flow and retain calendar behavior. |
| User consent disabled, matching app already granted tenant admin consent for all requested scopes | Connect as an ordinary user through the hosted app. Account selection/sign-in may appear, but no consent screen or repeating admin-approval loop. Callback completes, provider is connected, and code exchange returns a refresh token that is persisted. Record presence/success without recording token contents. |
| First connect with no existing grant | Use an account allowed to grant the requested permissions (an admin when tenant policy requires it). Microsoft displays the consent screen without forced consent, and connection succeeds after approval. An ordinary user with user consent disabled still legitimately needs admin approval; this fix must not bypass policy. |
| Reconnect existing provider | Reconnect using the same selected application and intended mailbox. Verify completion for the existing provider and a refresh token returned by the new code exchange and saved for subsequent refresh. Verify a refresh exchange succeeds; do not infer success solely from a previously stored token. |
| Google regression | Google email and calendar URL generation retains `prompt=consent` and `access_type=offline`. |
| Existing unit coverage | Package helper and legacy contract tests pass with `select_account` and existing scope assertions. |

## Risks, open questions, and release boundary

- No open implementation decision: use `select_account` in both email copies, preserve already-correct calendar builders, and leave generic IMAP unchanged.
- Live validation needs a test tenant with user consent disabled and an admin grant covering the exact selected app and requested scopes, plus a separate unconsented app/tenant case. Availability of those fixtures is the outstanding validation question; do not claim live acceptance from unit tests.
- Entra direct connect and Microsoft MCP connect share the changed package helper. Review their existing connect tests and smoke-check account selection/missing-grant behavior when those integrations are available; retain their custom scope lists unchanged.
- A grant for another app, incomplete scope grants, Conditional Access, or other tenant restrictions can still require interaction or deny access. Account selection is intentional and does not promise silent sign-in.
- Generic Microsoft-via-IMAP may retain the reported behavior; treating arbitrary OAuth providers requires a separate scoped change.
- Existing unrelated `package-lock.json` modifications were present at inspection and must not enter this plan commit or the implementation diff.
- This assignment ends after committing this plan only. No implementation, PR, merge, deployment, board transition, or customer message is part of the Design Session. Once the fix is merged and deployed under subsequent orders, the customer follow-up should report the deployed fix and invite retry; that follow-up remains outstanding until deployment is verified.
