# Automate Entra ID app registration for Microsoft email

## Intent

Replace the current “open Azure Portal, create an app, copy credentials, then return” dead end with a guided Microsoft Email setup in Providers settings. Administrators choose either the platform-managed multi-tenant application or a tenant-owned application created through Microsoft Graph; both paths finish by creating/binding the existing Microsoft profile consumed by the mailbox OAuth form.

## Existing seams

- `packages/integrations/src/actions/integrations/microsoftActions.ts` owns Microsoft profile CRUD, tenant-secret storage, Email consumer binding, computed redirect URIs, and Email scopes. `createMicrosoftProfile`, `setMicrosoftConsumerBinding`, `getMicrosoftProfileStatus`, and `getMicrosoftConsumerSetupStatus` remain the source of truth.
- `packages/integrations/src/components/email/MicrosoftProviderForm.tsx` deliberately does not collect client credentials. It checks Email consumer readiness and then starts mailbox OAuth through `initiateEmailOAuth`; keep that separation.
- `packages/integrations/src/components/email/ProviderSetupWizardDialog.tsx` routes Microsoft mailbox setup into `MicrosoftProviderForm`; it should link back to Providers settings but should not create applications itself.
- `docs/inbound-email/setup/microsoft.md` documents the current manual registration, required Web redirect URI, and delegated `Mail.Read`, `Mail.Read.Shared`, and `offline_access` permissions.
- The worktree has an unrelated modified `package-lock.json`; preserve it and exclude it from this plan commit.

## Design

### 1. Add an Email-specific guided setup surface in Providers settings

Extend the Microsoft provider/profile editor that already calls `getMicrosoftProfileStatus` and `createMicrosoftProfile`. Add a “Set up Microsoft Email” dialog with two explicit choices:

1. **Use the Alga platform app** — available only when the server reports configured platform Microsoft credentials. Show the application/client ID and generated tenant admin-consent URL, with copy/open actions and a warning that an Entra administrator must grant consent before mailbox authorization.
2. **Create an app in this tenant** — run a short bootstrap sign-in, create the application through Graph, create its service principal and password, persist the resulting profile, and bind it to the Email consumer.

The dialog must render the exact callback URI returned by server metadata rather than reconstructing it in the client. Completion returns to the ordinary profile list with the new Email-bound profile selected.

### 2. Introduce narrow server actions and pure builders

Add a focused module beside `microsoftActions.ts`, for example `packages/integrations/src/actions/integrations/microsoftEmailSetupActions.ts`, and keep profile persistence delegated to the existing internal/profile actions.

Pure helpers should build:

- the tenant-specific admin-consent URL: `https://login.microsoftonline.com/{tenant}/v2.0/adminconsent?client_id=...&redirect_uri=...&state=...`;
- the Graph application manifest with `signInAudience: AzureADMultipleOrgs`, a Web redirect URI from `getMicrosoftProfileStatus`, and delegated Microsoft Graph `requiredResourceAccess` entries for `Mail.Read`, `Mail.Read.Shared`, and `offline_access` using their stable permission IDs;
- sanitized result/error contracts that never return an access token and return a generated client secret only to the server-side profile persistence path.

Expose authenticated, `system_settings:update`-guarded actions for:

- `getMicrosoftEmailSetupOptions`: deployment callback URI, whether platform credentials are available, platform client ID, and a signed/expiring setup state;
- `getMicrosoftEmailAdminConsentUrl(tenantHint?)`: validate the tenant identifier, bind state to the current tenant/user, and return the URL;
- `createMicrosoftEmailApplication`: accept the bootstrap Graph authorization result/state, POST `/applications`, POST `/servicePrincipals`, call `addPassword`, create a Microsoft profile with Email capability, and bind that profile to `email`.

Reuse the existing tenant secret provider and Microsoft profile APIs so the generated password is stored under the profile secret reference and never written to the database, activity trail, browser logs, or response payload.

### 3. Add a dedicated bootstrap OAuth callback

The existing `/api/auth/microsoft/callback` is mailbox authorization and stores mailbox tokens; do not overload it. Add a setup-only callback such as `server/src/app/api/auth/microsoft/email-setup/callback/route.ts` and matching initiation helper.

The bootstrap authorization requests the minimum delegated Graph administration scopes needed to create an application/service principal and password. Use authorization-code + PKCE, a short-lived signed state containing the Alga tenant/user and return location, and a single-use server-side verifier. Validate issuer/tenant, nonce/state, and the signed-in administrator before using the access token. Do not persist the bootstrap access/refresh token after provisioning completes.

If Microsoft does not permit the requested app-registration operation for that administrator/tenant, return an actionable error and keep the manual/platform path available. Never silently broaden permissions.

### 4. Finish through the existing profile and mailbox flow

After Graph provisioning succeeds:

1. create the Microsoft profile using the returned application ID, tenant ID, generated secret, Email capability, and display name;
2. bind it with `setMicrosoftConsumerBinding({ consumerType: 'email', profileId })`;
3. show the tenant admin-consent URL for the newly created application;
4. return the administrator to Inbound Email, where `MicrosoftProviderForm` becomes ready and its existing **Authorize Access** button performs mailbox consent/token storage.

This ordering keeps application administration, tenant-wide admin consent, and per-mailbox delegated OAuth visible as three distinct states. Readiness should distinguish “profile created,” “admin consent pending,” and “mailbox connected” instead of treating credentials alone as full completion.

### 5. Tests and documentation

- Unit-test URL and manifest builders against exact redirect URI, audience, and required permission IDs.
- Action tests cover RBAC, tenant/state mismatch, Graph partial failure, secret non-disclosure, profile creation, and Email binding.
- Callback tests cover PKCE/state replay, issuer/tenant validation, denied consent, and cleanup of the one-time verifier.
- Component tests cover both setup choices, platform-app unavailable state, manual fallback, generated consent URL, and returning to mailbox authorization.
- Update `docs/inbound-email/setup/microsoft.md` to lead with the guided choices while retaining a manual-registration fallback and clearly separating admin consent from mailbox authorization.

## Implementation order

1. Export/refactor the existing redirect/scope/profile persistence helpers needed by the setup action without duplicating tenant-secret logic.
2. Add pure consent URL and application-manifest builders with behavioral tests.
3. Add the PKCE setup initiation/callback and one-time state storage.
4. Add Graph provisioning orchestration with compensating cleanup: if service-principal/password/profile creation fails, best-effort delete objects created during that attempt and report what remains.
5. Add the Providers settings dialog and wire completion to existing profile refresh/binding behavior.
6. Update `MicrosoftProviderForm` only to present improved readiness/progress links; leave mailbox OAuth intact.
7. Update docs and add end-to-end smoke evidence for both platform consent URL generation and a simulated/controlled Graph provisioning response, explicitly disclosing any simulator.

## Non-goals

- No changes to outbound email transport or `Mail.Send` behavior.
- No reuse of the Entra user-sync/CIPP setup flow; this feature provisions the application used by Microsoft Email.
- No storage of bootstrap Graph tokens or generated secrets in client state, database columns, logs, or artifacts.
- No automatic grant of tenant admin consent; Microsoft must keep that administrator-controlled boundary.
- No removal of manual app registration, hosted credential fallback, or the existing mailbox OAuth callback.

## Risks

- Graph application creation is tenant-policy and role dependent. The UI must detect authorization failure and provide a clean platform/manual fallback.
- Permission GUID mistakes create an apparently valid but unusable app. Keep a named constant table and verify it behaviorally against the emitted manifest.
- Partial Graph provisioning can orphan an application/service principal. Track created object IDs server-side during the request and perform best-effort compensating deletion.
- A generated client secret is irrecoverable after creation. Persist it atomically before declaring success; if persistence fails, delete/revoke the credential and fail closed.
- Platform multi-tenant consent must use tenant-scoped admin-consent URLs and signed state; `/common` is appropriate for mailbox OAuth but insufficient to identify which tenant granted admin consent.
- The existing metadata currently lists broader Email scopes (`Mail.ReadWrite`/`Mail.Send`) than the card’s required read-only set. The implementation must reconcile this deliberately and must not broaden the new app manifest without a documented consumer requirement.
