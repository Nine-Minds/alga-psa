# IMAP OAuth authorization: human review guide

**Purpose:** verify that changing an inbound mailbox connection requires current administrator authority and cannot replace credentials through forged, stale, replayed, or cross-tenant OAuth state.

**Revision binding:** this guide is maintained with the source revision. The workflow review packet records the full commit SHA and this path for the published repair revision.

**Evidence status:** repository checks are current to the bound revision once published. The product smoke run dated **2026-11-01**, revision `e5ddee1a5ae54247e95423b07a1e55d906a3f520`, is historical evidence only. It used a minimal simulator for the external consent/token endpoint. It is not a current walkthrough and is not human approval. This repair did not start the server or perform browser checks. The review owner must run the live checks below against the published revision.

## User impact

- **Administrators** with `ticket_settings:update` can set up or reconnect an IMAP OAuth mailbox. They must complete provider consent within ten minutes. Their callback is accepted only while they remain an active internal user with that permission.
- **Readers** can still view permitted email settings, but cannot initiate or reconnect OAuth mailboxes. Their rejected attempts do not mint a grant or change provider credentials.
- **Client users** cannot manage MSP inbound providers, even if a permission is mistakenly assigned. They receive a forbidden response and no credentials change.

## Before testing

1. Use a disposable test tenant with an IMAP OAuth provider and known baseline credential values. Record a secure digest of the stored credential fields out of band; never paste credentials or signing keys into screenshots, logs, or this guide.
2. Apply additive migration `server/migrations/20261101090000_create_email_oauth_grants.cjs` before deploying code that requires the grant table.
3. Provision one high-entropy `OAUTH_STATE_SIGNING_KEY` using the environment's existing secret provider and make the identical value readable by every server instance. Supported application-secret providers are environment, filesystem, and Vault; composite providers read the first configured provider returning a value. Follow [signing-key provisioning and rollout](imap-oauth-state-signing-key.md). Do not create a per-instance key or fallback.
4. Set `NEXT_PUBLIC_BASE_URL` to the externally reachable application origin. Register the exact callback URI `https://<application-host>/api/email/oauth/imap/callback` with the OAuth provider and ensure the configured provider redirect uses that origin. The initiate route otherwise defaults to localhost.
5. Verify every serving instance resolves the app secret without printing it, the migration is recorded in the deployment database, and the database application role can insert and consume a test grant. Do not infer deployment readiness from repository configuration.

## Navigation

Sign in as an internal administrator and open **MSP Settings → Email** (`/msp/settings/email`). Locate the disposable IMAP provider. The card menu exposes **Reconnect OAuth** for an OAuth-configured IMAP mailbox. Use the normal setup flow for a new provider when validating first-time setup. The email OAuth initiate endpoint is `POST /api/email/oauth/imap/initiate`; the callback is `/api/email/oauth/imap/callback`.

## Review checks

For each rejected check, compare the provider row and IMAP OAuth credential values with the recorded baseline after the request. The expected result is unchanged credentials, provider status, and connection state. Also confirm no token endpoint exchange occurred where applicable.

1. **Administrator success.** As an active internal user with `ticket_settings:update`, initiate setup or choose **Reconnect OAuth**, complete consent with the configured test provider, then return to Email settings. Expected: callback succeeds, the provider remains the same tenant/provider, new credentials persist, status is connected, and a consumed grant exists. Reload settings and confirm the connection remains.
2. **Reader and client rejection.** Repeat initiation as an internal reader lacking `ticket_settings:update`, then as an authenticated client user (even if `ticket_settings:update` is assigned). Expected: both are rejected (403); neither gets an authorization URL or grant; credentials remain at baseline.
3. **Permission revoked during consent.** Start as an authorized admin, then remove `ticket_settings:update` before completing consent. Expected: callback returns forbidden, performs no token exchange or credential write, and the provider remains at baseline.
4. **Invalid state forms.** Using a captured disposable attempt, test a payload with a changed signature (forged), a modified payload (tampered), a legacy unsigned payload, and a state with an altered tenant/provider/user/purpose binding. Expected: callback rejects each before exchange and leaves provider credentials unchanged.
5. **Expired attempt.** Wait until the ten-minute state/grant lifetime has passed or use a test fixture with an expired grant. Expected: callback rejects and leaves credentials unchanged.
6. **Replay.** Complete one successful callback, then submit the same callback state again. Expected: the second callback is rejected; only one exchange/write occurred and persisted credentials still equal the first successful result. Verify the grant has one consumed timestamp.
7. **Foreign-tenant provider.** Use a provider ID that exists only in another disposable tenant while keeping state/grant scoped to the initiating tenant. Expected: provider lookup/callback is rejected without exchange or changes in either tenant. Do not inspect or disclose another real tenant's credentials.

## Evidence ledger

- **Executed during this repair:** route and state behavioral unit suites cover role rejection, grant issuance, signed/tampered/unsigned/expired/replay/cross-tenant state, permission revocation and unchanged credentials. Isolated database integration coverage checks migration retry, application-role access, and exactly one successful atomic consume. Build and full server typecheck results are recorded in the PR/workflow result for the published revision.
- **Historical only:** product smoke evidence from 2026-11-01 at revision `e5ddee1a5ae54247e95423b07a1e55d906a3f520`, previously described in PR #4086. It reported admin success and reader/client/revocation/invalid-state/replay/foreign-tenant rejection, with credential snapshots. External token exchange used a minimal simulator. Evidence was stored under `/tmp/alga-smoke-evidence/security-authz-post-20261101-2224`; that local path is not the durable review artifact.
- **Still for review owner:** execute all seven checks on the currently deployed/published revision, record the exact revision, test tenant, outcomes, credential-preservation evidence, and any deviations. Confirm the configured signing key and callback origin in each target environment without exposing values. Human review and production deployment are pending and must be recorded separately.

## Rollout and rollback

Provision the shared key and apply the additive migration **before** deploying application code that requires them. Missing/unreadable key intentionally fails initiation closed (500; no unsigned state is issued); callback cannot validate state without the key. Rotating the key invalidates outstanding OAuth attempts signed with the old key; users must restart them. During rollback, keep the additive table and shared key in place until no new code uses them; rolling application code back may make outstanding signed attempts unusable, so restart those attempts after the compatible version is restored. Do not roll back by inventing a fallback key or dropping grants while callbacks may still be in flight.

## Review owner sign-off (leave blank until performed)

- Published revision:
- Environment and date:
- Checks passed / failed:
- Credential-preservation evidence location:
- Reviewer:
- Deployment observations (if any):
