# Microsoft coverage boundaries

Mailbox/calendar provider integration, Teams integration, and user SSO linking are separate claims. A pass in one does not establish the others. This inventory is grounded in the current product and emulator sources; it is not a live Microsoft protocol certification.

| Surface | Existing evidence | Remaining requirement |
| --- | --- | --- |
| Mailbox OAuth, webhook ingestion and reply | `e2e-tests/tests/microsoft-mailbox.spec.ts`; `evidence/host-microsoft-mailbox-real-worker.json` exercises the actual email worker | Current-source native CI result with every consuming process configured for the same emulator |
| Personal calendar OAuth, remote event import, UI edits and recovery | `e2e-tests/tests/microsoft-calendar.spec.ts`; `evidence/host-calendar-iana-delta.json` covers 503, permission and throttling recovery | Current-source native CI result; Windows time-zone names, ambiguous DST times and recurring-series behavior remain outside this evidence |
| Teams meeting and bot wire routes | `packages/emulators/msgraph/tests/smoke.test.ts` exercises meeting artifacts, signed inbound activities, connector replies and activity notifications | The new development-tests/teams-profile.spec.ts covers setup token outage/recovery and saved profile identity; development execution passed; see evidence/host-teams-development-profile.json. Meeting/bot product UI coverage is still absent. |
| Teams endpoint and bot trust policy | `ee/packages/microsoft-teams/src/lib/teams/__tests__/microsoftEndpoints.test.ts` and bot OpenID/service-URL trust tests; 28 native tests passed during this audit | Keep the production endpoint guard; these tests are not an exception that enables production-config emulator testing |
| User Microsoft SSO/account linking | Emulator authorization/token routes and Bot Framework discovery endpoints exist | No demonstrated Alga sign-in/account-linking journey. Bot Framework discovery is not proof of user OIDC discovery, issuer/audience validation, nonce validation, or account-linking behavior |

`ee/packages/microsoft-teams/src/lib/teams/emulatorMode.ts` denies every Teams emulator override when `NODE_ENV=production`. In other environments it still requires `TEAMS_EMULATOR_MODE=true` or `1`. This is a credential-routing and token-trust boundary. Do not weaken it to make the production browser lane pass.

The next Teams implementation should use an explicitly labeled development-configuration lane with the real product flow and stateful emulator. It must report that configuration and must not satisfy the production-artifact requirement. A separate supported Microsoft sandbox run would be needed to establish live-provider behavior; no sandbox credentials or account provisioning are currently established by this plan's evidence.

For SSO, first establish the exact discovery, authorization, token and JWKS endpoints consumed by the product and test issuer/audience/nonce rejection through the real sign-in flow. Prelinked users and successful email OAuth are not substitutes. Keep SSO coverage unclaimed until that evidence exists.

F034 and F037 remain incomplete. Native guard-test log: `/tmp/alga-teams-guard-audit-native.log`. The initial sandbox run failed to bind its loopback identity server (`EPERM`); it is not counted as a pass.

Run the draft Teams setup journey with `E2E_EDITION=enterprise E2E_TEAMS_DEVELOPMENT=true` and `playwright.teams-development.config.ts`. The app must run with `NODE_ENV=development` and `TEAMS_EMULATOR_MODE=true`, plus the shared Graph endpoints and isolated database/secret-store settings described in host-provider-testing.md. One development case passed with real UI and provider requests; it is not production-artifact evidence. The test checks that the emulator actually receives the failed and recovered token requests, so a flag declaration alone cannot produce a pass.
