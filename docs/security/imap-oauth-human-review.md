# IMAP OAuth authorization: human review guide

**Purpose:** verify that changing an inbound mailbox connection requires current administrator authority and cannot replace credentials through forged, stale, replayed, or cross-tenant OAuth state.

**Revision binding:** this guide is maintained with the source revision. Workflow project state and its durable annotation record the full commit SHA and this path for the published repair revision.

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

### Disposable test personas and provider

Use two disposable tenants, Tenant A and Tenant B, and create a fake OAuth2 IMAP provider in Tenant A through **MSP Settings → Email**. Use OAuth URLs on a controlled simulator or reserved `.invalid` endpoint; do not point a fixture at a real mailbox. Record the provider UUID from the provider list response in browser DevTools (Network), not from token or credential fields.

Create an internal reader in **MSP Settings → Users**. In **Security Settings → User Roles**, assign a role that has `ticket_settings:read` and lacks `ticket_settings:update`; confirm this in **Security Settings → Permissions**. Create a client portal user under **MSP Settings → Users**, switch the ViewSwitcher to **Client Portal**, then choose **Create New Client User** and link it to a disposable client/contact. Use separate browser profiles for admin, reader, and client so their session cookies cannot be confused. These fixtures are created in the disposable tenant through the application UI; remove or deactivate them after review.

The client route check is expected to reject on `user_type` before checking permissions. To prove this even when RBAC itself resolves `ticket_settings:update` for the client, use a disposable tenant database operator to enable the catalog permission's client flag temporarily and attach it to a client role. The `permissions.client` and `roles.client` flags are both required by `hasPermission`; the permission catalog normally marks this action MSP-only. First record the current permission flag and confirm there is exactly one catalog row:

```sql
SELECT permission_id, client AS previous_client_flag
FROM permissions
WHERE tenant = '<tenant-a-uuid>'::uuid
  AND resource = 'ticket_settings' AND action = 'update';
```

Record the returned `permission_id` and `previous_client_flag` privately. Then run this setup and keep the returned role ID for cleanup:

```sql
BEGIN;
UPDATE permissions SET client = true
WHERE tenant = '<tenant-a-uuid>'::uuid AND permission_id = '<permission-id>'::uuid;
WITH test_role AS (
  INSERT INTO roles (tenant, role_name, description, msp, client)
  VALUES ('<tenant-a-uuid>'::uuid, 'review-client-oauth-<unique-suffix>', 'Disposable OAuth review fixture', false, true)
  RETURNING tenant, role_id
), linked_permission AS (
  INSERT INTO role_permissions (tenant, role_id, permission_id)
  SELECT r.tenant, r.role_id, '<permission-id>'::uuid FROM test_role r
  RETURNING tenant, role_id
)
INSERT INTO user_roles (tenant, user_id, role_id)
SELECT tenant, '<client-user-uuid>'::uuid, role_id FROM linked_permission;
SELECT role_id FROM roles
WHERE tenant = '<tenant-a-uuid>'::uuid
  AND role_name = 'review-client-oauth-<unique-suffix>';
COMMIT;
```

Now use the session request below as the client and expect HTTP 403. The route
test suite additionally verifies that a client can resolve this permission
through `hasPermission` while `assertProviderMutationAuthority` still rejects
that client based on user type. After recording the check, remove the fixture
and restore the catalog flag to the exact prior value:

```sql
BEGIN;
DELETE FROM user_roles WHERE tenant = '<tenant-a-uuid>'::uuid AND user_id = '<client-user-uuid>'::uuid AND role_id = '<role-id>'::uuid;
DELETE FROM role_permissions WHERE tenant = '<tenant-a-uuid>'::uuid AND role_id = '<role-id>'::uuid;
DELETE FROM roles WHERE tenant = '<tenant-a-uuid>'::uuid AND role_id = '<role-id>'::uuid;
UPDATE permissions SET client = <previous-client-flag>::boolean
WHERE tenant = '<tenant-a-uuid>'::uuid AND permission_id = '<permission-id>'::uuid;
COMMIT;
```

Replace the suffix consistently. Never attach this role or temporarily enabled
catalog permission to a real tenant or user. Run cleanup even if a review check
fails.

The authenticated session request can be made directly from that persona's browser DevTools → Console; no prior IMAP initiation request is needed. This same-origin fetch uses the portal's current HttpOnly session cookie without reading or copying it. It prints status and response shape only, never state or authorization URL:

```js
window.requestImapOAuthReview = async (providerId) => {
  const response = await fetch('/api/email/oauth/imap/initiate', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ providerId }),
  });
  return { status: response.status, body: await response.json() };
};
const attempt = await window.requestImapOAuthReview('<tenant-a-provider-uuid>');
console.log({ status: attempt.status, hasState: Boolean(attempt.body.state), hasAuthUrl: Boolean(attempt.body.authUrl), error: attempt.body.error });
```

For a valid administrator attempt needed by callback checks, retain state in a
browser variable without printing it. Use this variant as the admin; it stores
the response in the current tab and logs only status and response shape:

```js
window.oauthReviewResponse = await window.requestImapOAuthReview('<tenant-a-provider-uuid>');
console.log({ status: window.oauthReviewResponse.status, hasState: Boolean(window.oauthReviewResponse.body.state), hasAuthUrl: Boolean(window.oauthReviewResponse.body.authUrl) });
```

To transfer state to the callback shell's hidden prompt without displaying it,
run Chrome DevTools' `copy(window.oauthReviewResponse.body.state)` helper and
paste into `read -rsp`. Keep state out of shell history, tickets, logs, and
screenshots. The initiate response also includes `authUrl`; open it privately
to complete the test-provider flow when running admin success.

For a shell-based request from any persona, use DevTools → Network → the
`POST /api/email/oauth/imap/initiate` request → **Copy as cURL**. Keep the
copied `Cookie` header private. The request body is
`{ "providerId": "<provider-uuid>" }`; the example below prompts for the cookie
and suppresses the response body.

```bash
API_ORIGIN='https://<application-host>'
PROVIDER_ID='<tenant-a-provider-uuid>'
read -rsp 'Paste Cookie header value from Copy as cURL: ' ALGA_COOKIE; echo
HTTP_STATUS=$(curl -sS -o /dev/null -w '%{http_code}' \
  -X POST "$API_ORIGIN/api/email/oauth/imap/initiate" \
  -H "Cookie: $ALGA_COOKIE" -H 'Content-Type: application/json' \
  --data "{\"providerId\":\"$PROVIDER_ID\"}")
unset ALGA_COOKIE
printf 'initiate HTTP %s\n' "$HTTP_STATUS"
```

For an authorized admin attempt whose state must be retained, capture the response without printing it. Store the returned `state` and `authUrl` only in shell variables; the state is a short-lived bearer value. Use the UI's OAuth popup to complete consent, or open the captured `authUrl` privately. Do not commit, paste, or screenshot the state or cookie.

```bash
read -rsp 'Paste admin Cookie header value from Copy as cURL: ' ALGA_COOKIE; echo
INITIATE_JSON=$(curl -fsS -X POST "$API_ORIGIN/api/email/oauth/imap/initiate" \
  -H "Cookie: $ALGA_COOKIE" -H 'Content-Type: application/json' \
  --data "{\"providerId\":\"$PROVIDER_ID\"}")
unset ALGA_COOKIE
STATE=$(printf '%s' "$INITIATE_JSON" | jq -er '.state')
AUTH_URL=$(printf '%s' "$INITIATE_JSON" | jq -er '.authUrl')
unset INITIATE_JSON
```

Establish a credential baseline before each attempted mutation, and compare it afterward. Run as a database operator against only the disposable tenants; this returns a digest and status, never credential values:

```sql
SELECT p.tenant, p.id, p.status,
       md5(jsonb_build_array(c.access_token, c.refresh_token, c.token_expires_at)::text) AS credential_digest
FROM email_providers p
JOIN imap_email_provider_config c
  ON c.tenant = p.tenant AND c.email_provider_id = p.id
WHERE (p.tenant, p.id) IN (('<tenant-a-uuid>'::uuid, '<provider-uuid>'::uuid),
                           ('<tenant-b-uuid>'::uuid, '<provider-uuid>'::uuid));
```

Save the digest plus status locally before and after a rejection, and compare equality. Do not save token columns, copied cookie headers, callback state, OAuth codes, or the signing key in evidence.

## Navigation

Sign in as an internal administrator and open **MSP Settings → Email** (`/msp/settings/email`). Locate the disposable IMAP provider. The card menu exposes **Reconnect OAuth** for an OAuth-configured IMAP mailbox. Use the normal setup flow for a new provider when validating first-time setup. The email OAuth initiate endpoint is `POST /api/email/oauth/imap/initiate`; the callback is `/api/email/oauth/imap/callback`.

## Review checks

For each rejected check, compare the provider row and IMAP OAuth credential values with the recorded baseline after the request. The expected result is unchanged credentials, provider status, and connection state. Also confirm no token endpoint exchange occurred where applicable.

1. **Administrator success.** As an active internal user with `ticket_settings:update`, initiate setup or choose **Reconnect OAuth**, complete consent with the configured test provider, then return to Email settings. Expected: callback succeeds, the provider remains the same tenant/provider, new credentials persist, status is connected, and a consumed grant exists. Reload settings and confirm the connection remains.
2. **Reader and client rejection.** Run the authenticated request template above once with the reader session and once with the client session. For example, the request is `POST /api/email/oauth/imap/initiate` with `{"providerId":"<provider-uuid>"}` and that persona's Cookie header. Expected for each: HTTP 403; no `state` or `authUrl` is returned; no `email_oauth_grants` row is created; credentials/status digest matches baseline.

   To verify that neither request created a grant, query the disposable database using the provider ID and test user IDs captured from their profile screens:

   ```sql
   SELECT count(*) AS grant_count
   FROM email_oauth_grants
   WHERE tenant = '<tenant-a-uuid>'::uuid
     AND provider_id = '<provider-uuid>'::uuid
     AND initiated_by_user_id IN ('<reader-user-uuid>'::uuid, '<client-user-uuid>'::uuid);
   ```

   Expected: `grant_count = 0`.
3. **Permission revoked during consent.** As the test admin, run the retained-state initiation snippet above. Before callback, use a separate admin session at **Security Settings → User Roles** or **Security Settings → Permissions** to remove `ticket_settings:update` from the initiating user's effective role. Then send the callback without a session cookie:

   ```bash
   CALLBACK_STATUS=$(curl -sS -o /dev/null -w '%{http_code}' -G \
     "$API_ORIGIN/api/email/oauth/imap/callback" \
     --data-urlencode 'code=review-fixture-code' --data-urlencode "state=$STATE")
   printf 'callback HTTP %s\n' "$CALLBACK_STATUS"
   unset STATE AUTH_URL
   ```

   Expected: HTTP 403, no token exchange, grant is consumed, provider status and credential digest remain at baseline. Re-grant the role only after recording the result.
4. **Invalid state forms.** Start a fresh disposable initiation and retain its `STATE`. Define a callback helper that suppresses the response body and reports only HTTP status:

   ```bash
   callback_status() {
     curl -sS -o /dev/null -w '%{http_code}\n' -G \
       "$API_ORIGIN/api/email/oauth/imap/callback" \
       --data-urlencode 'code=review-fixture-code' --data-urlencode "state=$1"
   }
   IFS='.' read -r PAYLOAD SIGNATURE <<EOF
   $STATE
   EOF
   FORGED="${PAYLOAD}.AAAA"
   TAMPERED="A${STATE#?}"
   UNSIGNED="$PAYLOAD"
   callback_status "$FORGED"
   callback_status "$TAMPERED"
   callback_status "$UNSIGNED"
   ```

   Each response should be HTTP 400, with no exchange or credential change. For altered tenant/provider/user/purpose, use one payload mutation at a time with a signature that no longer matches, for example changing the first payload character as above; each is rejected before provider lookup. Make a new initiation for the valid expiry check and replay check.
5. **Expired attempt.** Retain a fresh valid state/grant, wait until more than ten minutes after its initiation, then call `callback_status "$STATE"`. Expected: HTTP 400 for expired state, no exchange, and credentials unchanged. The actual state remains correctly signed; altering its timestamp instead would make this a signature-failure test, not an expiry test.
6. **Replay.** Complete one successful callback, then submit the same callback state again. Expected: the second callback is rejected; only one exchange/write occurred and persisted credentials still equal the first successful result. Verify the grant has one consumed timestamp.
7. **Foreign-tenant provider.** Public initiation cannot issue a signed state for a provider that does not exist in its tenant, so prepare this check with a disposable database fixture after obtaining state/grant through the authorized admin initiation snippet. Keep the SQL operator session private and use only Tenant A/B test data. In one transaction, clone the provider and IMAP config from A to B with the same provider UUID, then delete the A provider/config rows while leaving the A grant untouched:

   ```sql
   BEGIN;
   INSERT INTO email_providers
   SELECT (jsonb_populate_record(NULL::email_providers,
            to_jsonb(p) || jsonb_build_object(
              'tenant', '<tenant-b-uuid>'::uuid,
              'mailbox', 'foreign-review-<unique-suffix>@example.invalid'))).*
   FROM email_providers p
   WHERE p.tenant = '<tenant-a-uuid>'::uuid AND p.id = '<provider-uuid>'::uuid;

   INSERT INTO imap_email_provider_config
   SELECT (jsonb_populate_record(NULL::imap_email_provider_config,
            to_jsonb(c) || jsonb_build_object('tenant', '<tenant-b-uuid>'::uuid))).*
   FROM imap_email_provider_config c
   WHERE c.tenant = '<tenant-a-uuid>'::uuid AND c.email_provider_id = '<provider-uuid>'::uuid;

   DELETE FROM imap_email_provider_config
   WHERE tenant = '<tenant-a-uuid>'::uuid AND email_provider_id = '<provider-uuid>'::uuid;
   DELETE FROM email_providers
   WHERE tenant = '<tenant-a-uuid>'::uuid AND id = '<provider-uuid>'::uuid;
   COMMIT;
   ```

   After the fixture move, run the credential digest query above and record the Tenant B row as the pre-callback baseline (Tenant A should have no provider row). Then use the retained A state with `code=review-fixture-code` in the callback command above. Expected: HTTP 404 before grant consumption or token exchange, Tenant B's digest/status stays unchanged, and Tenant A remains without a provider. The A grant is now an unused fixture; delete it by its captured nonce/tenant with the database operator after recording the result. Do not perform this mutation against a real tenant or inspect another tenant's credentials.

## Evidence ledger

- **Executed during this repair:** route/state behavioral tests cover role rejection, grant issuance, missing-key fail-closed behavior, signed/tampered/unsigned/expired/replay/cross-tenant state, permission revocation, and unchanged credentials. The client RBAC fixture test verifies `hasPermission(client, 'ticket_settings', 'update')` is true when both client flags are enabled while the mutation authority guard rejects that same user type. The grant, route, state, and client RBAC suites passed 18/18 in this follow-up. The migration integration test checked retry, application-role access, and exactly one successful atomic consume. The full server typecheck passed in this follow-up with a 12 GB Node heap. Static Compose checks rendered CE and EE without a signing-key mount by default, with the opt-in filesystem mount, environment pass-through using a dummy value, and Vault provider selection using placeholder configuration; no secret value was printed and no application service was started. The production build compiled and generated all 74 static pages, then exited at Next.js `SecurityFatalError` because the installed Next.js version is flagged by the npm advisory check; a second 12 GB run reached the same hold. This security gate was not bypassed.
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
