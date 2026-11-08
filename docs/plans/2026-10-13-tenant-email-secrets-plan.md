# Tenant outbound email secrets: move out of `tenant_email_settings.provider_configs`

- Card: 2ff07240 "Move tenant SMTP/Resend secrets out of plaintext tenant_email_settings"
- PSA ticket: alga-2026-0002693 (SMT-Tech s. r. o.)
- Branch: `feature/move-tenant-smtp-resend-secrets-out-of-plaintext` (base `d6dc22c273`)

## 1. Current state (verified in code)

### Write path: plaintext is persisted
- UI: `packages/integrations/src/components/email/admin/EmailSettings.tsx:332-339` (SMTP password) and `:416-417` (Resend API key). The EE hosted screen does the same at `ee/server/src/components/settings/email/ManagedEmailSettings.tsx:718-725`. Both send whatever the user typed in `providerConfigs[].config.password` / `.apiKey`. If the field still holds the `'***'` mask, they send the mask.
- Server action: `updateEmailSettings` in `packages/integrations/src/actions/email-actions/emailSettingsActions.ts:181-372`.
  - `mergeProviderSecrets` (`:66-89`) swaps `'***'` back to the stored value it read from the DB.
  - `:318-327` writes `provider_configs: JSON.stringify(mergedSettings.providerConfigs)`, so the real password and API key go into the `json` column as plain text.
- Other writers create default configs only, with empty secrets: `ee/temporal-workflows/src/db/tenant-operations.ts:462-468` (tenant provisioning) and `packages/integrations/src/email/domains/services/ManagedDomainService.ts:328` (`[]`).

### Read path: plaintext is consumed
- `TenantEmailService.loadTenantEmailSettings` (`packages/email/src/TenantEmailService.ts:821-843`) → `normalizeSettingsRecord` (`:636-650`) → `normalizeProviderConfigs` (`:684-714`). This passes the JSON through unchanged, so every `TenantEmailSettings` object in memory holds the secrets.
- The secret is used when the provider is initialized, not when each message is sent:
  - `EmailProviderManager.initialize` (`packages/email/src/providers/EmailProviderManager.ts:29-80`) calls `resolveProviderConfig` (`:251-279`) and then `provider.initialize(...)`.
  - SMTP: `SMTPEmailProvider.ts:224-241` and `:43-55` (`auth.pass`).
  - Resend: `ResendEmailProvider.ts:290` (`config.apiKey || config.api_key`).
  - Resend already has a fallback chain when `apiKey` is empty (`EmailProviderManager.ts:344-387`): tenant secret `resend_api_key`, then `resend_api_key_<providerId>`, then app secret `resend_api_key`, then the `RESEND_API_KEY` env var.
- Everything that initializes a provider goes through `EmailProviderManager.resolveProviderConfig`:
  - `TenantEmailService.refreshProviderState` (`:735-777`) and `getEmailProvider` (`:361-462`)
  - `testConnection` (`:498-560`)
  - outbound diagnostics (`packages/email/src/diagnostics/outboundDiagnostics.ts:69-112`)
  - the workflow `email.send` action (`shared/workflow/runtime/actions/businessOperations/email.ts:173-189`)
- Provider caching: `getProviderSettingsFingerprint` (`TenantEmailService.ts:790-807`) hashes `providerConfigs` and `updatedAt`. The provider is rebuilt only when that fingerprint changes.

### Client exposure today
- `getEmailSettings` (`emailSettingsActions.ts:161-172`) replaces `password` and `apiKey` with `'***'`. The browser does not get the values today, but the server holds them in memory and the database holds them in plain text.
- `updateEmailSettings` returns `getEmailSettings()` (`:359`), so its response is masked as well.
- Other callers of `getTenantEmailSettings` do not return the settings object to the client. Checked: `emailSenderActions.ts`, `email/src/senderActions.ts`, `marketing/sequenceActions.ts`, `projects/projectStatusUpdateActions.ts`, `notifications/email.ts`, and the workflow email action. Each derives other values from the settings or uses them server-side only. I found no REST/API route that serializes `tenant_email_settings`.
- **Conclusion:** the finding is confirmed. `provider_configs[*].config.password` (SMTP) and `.apiKey` / `.api_key` (Resend) are stored as plain text. Masking hides them from the client, but they are not protected in the database.

### Secret store
- `ISecretProvider` (`packages/core/src/lib/secrets/ISecretProvider.ts`) exposes `getTenantSecret`, `setTenantSecret` and `deleteTenantSecret`. Get the instance with `getSecretProviderInstance()`.
- Hosted server pods: `readChain env,filesystem,vault`, `writeProvider vault` (nm-kube-config `alga-psa/hosted.values.yaml:365-372`).
- CE compose: `env,filesystem` / `filesystem` (`docker-compose.ce.yaml:46-47` and others).
- Filesystem secret names must be one path segment of at most 255 characters (`fsSecretCore.ts:122-135`).
- Vault `setTenantSecret` reads, merges and writes the whole tenant KV map (`VaultSecretProvider.ts:146-190`).
- Precedent for this pattern: the calendar Microsoft profiles store `client_secret_ref` in the DB and the secret in the provider (`ee/packages/calendar/src/lib/microsoftConsumerProfileResolution.ts:238, 299, 424`).

## 2. Design

### 2.1 Storage model
Each secret moves into the tenant secret provider under a **versioned** name. `provider_configs` keeps only a reference to it:

```jsonc
{ "providerId": "smtp-provider", "providerType": "smtp", "isEnabled": true,
  "config": { "host": "...", "port": 587, "username": "...", "from": "...",
              "secretRefs": { "password": "email_outbound_smtp_password_3f2a…" } } }
```

- Name format: `email_outbound_<providerType>_<field>_<uuid>`. Fields: `password` for SMTP, `api_key` for Resend. The name is built only from fixed strings and a server-generated UUID. It never includes `providerId`, so a value from the client can never become a secret path.
- **Why versioned rather than one fixed name per tenant:** the new secret is written first, under a new name. The DB row is then switched to point at it, and the old name is deleted last. The switch is the single DB write, so it is atomic. A failed save leaves the old credential working, plus at most one orphaned secret, which we clean up best-effort. With a fixed name, a save whose DB write failed would still have replaced the live password.
- **Why the reference lives in `config`:** `providerConfigs` already feeds the provider fingerprint. A rotated credential changes the reference, which changes the fingerprint, which rebuilds the provider in every process. No new cache-invalidation mechanism is needed. This also makes a rotation visible across processes even if `updatedAt` did not move.
- No schema change. `provider_configs` stays a `json` column.

### 2.2 New module: `packages/email/src/providerSecrets.ts` (server-only)
The secret rules live in one place. Today they are spread across `SECRET_FIELDS` in the action, the inline masking in `getEmailSettings`, and `normalizeSecretValue` in the manager.

- `PROVIDER_SECRET_FIELDS`:
  - `smtp`: `[{ field: 'password', aliases: [] }]`
  - `resend`: `[{ field: 'apiKey', aliases: ['api_key'] }]`
  - Microsoft has no inline secret; its OAuth secrets are already in `microsoft_email_provider_config`.
- `SECRET_MASK = '***'`. The UI contract stays as it is (see 2.5).
- `persistProviderSecrets(tenant, incoming, existing, secretProvider)` → `{ configs, committedRefs, staleRefs }`. For each secret field:
  - `'***'` or missing: keep the existing `secretRefs[field]`. If the existing config still holds legacy plaintext, migrate it now (write it to the store and record a reference).
  - empty string: clear it. Drop the reference and queue the old name for deletion.
  - any other value: write it to a new versioned name, set the reference, and queue the old name for deletion.
  - In every case, delete the plaintext key and its aliases from `config`.
- `resolveProviderSecrets(tenant, config, secretProvider)` → a runtime config with the plaintext values filled in.
  - **Fails fast:** if a reference exists but the store returns `undefined`, throw `EmailProviderError` with code `EMAIL_PROVIDER_SECRET_MISSING` and an actionable message ("The saved SMTP password could not be read from the secret store; re-enter it in Outbound Email settings"). Never fall back silently.
  - If there is no reference but legacy plaintext is present, use the plaintext and log a `warn` once per provider build. This keeps things working during the window before the backfill runs.
- `redactProviderConfigs(configs)`, used by the client-facing action:
  - Removes every secret field, its aliases and `secretRefs`.
  - Sets `config[field] = '***'` when a reference or legacy value exists, otherwise `''`.
  - Replaces the inline masking at `emailSettingsActions.ts:161-172`.
- `migrateTenantProviderSecrets(knex, tenant, secretProvider)`: the per-tenant backfill unit (see 2.6).

### 2.3 Read path changes
- `EmailProviderManager.resolveProviderConfig` (`EmailProviderManager.ts:251-279`):
  - For `smtp` and `resend`, call `resolveProviderSecrets` first.
  - Resend falls through to `getResendFallbackApiKey` only when there is **no** reference and no legacy key. That keeps the existing system and env fallback for managed-domain tenants.
  - This is the single place where secrets are resolved, so `TenantEmailService`, `testConnection`, diagnostics and the workflow `email.send` action all get it with no further edits.
- `normalizeSecretValue` (`:388-399`) moves into `providerSecrets.ts`.
- `TenantEmailService` and `TenantEmailSettings` do **not** change shape. Settings objects in memory will no longer carry plaintext once a tenant is migrated.
- Timing: the secret is resolved when the provider is built. On every send, `refreshProviderState` checks whether the fingerprint changed and rebuilds the provider if so. In practice this means "resolved at send time" without a Vault round trip on every message.

### 2.4 Write path changes
`updateEmailSettings` (`emailSettingsActions.ts:181-372`):
1. Replace `mergeProviderSecrets` (`:66-89`, `:198-200`) with `persistProviderSecrets` (2.2). Secrets are written to the store **before** the DB transaction at `:329-351`. They are not written inside it, because the secret store is outside the transaction.
2. The DB transaction stores configs that contain references only.
3. After the commit, delete `staleRefs` best-effort and log failures with the name only.
4. If the transaction or any validation after step 1 fails, delete `committedRefs` best-effort (the orphan cleanup). Validation steps that can fail without needing the secret (sender checks `:252-270`, From checks `:288-316`) move **before** `persistProviderSecrets`. That way a rejected save never touches the store.
5. The Microsoft branch (`:203-245`) is unaffected: it has no inline secrets.

`getEmailSettings` (`:161-172`): use `redactProviderConfigs`. The default-settings branch (`:134-159`) keeps `password: ''`.

### 2.5 UI
No change to the contract. Both forms already render `'***'` as an empty field and send `'***'` back when the field is untouched:
- `EmailSettings.tsx:337, 417`
- `ManagedEmailSettings.tsx:723`

The comment at `ManagedEmailSettings.tsx:419` gets reworded to "resolved from the secret store". A follow-up could add a "saved — leave blank to keep" placeholder, but that is cosmetic and out of scope.

### 2.6 Backfill: what runs where (Citus-safe)
**Constraint:** knex migrations (`server/migrations/*.cjs`) cannot write to the secret store.
- No existing migration imports `@alga-psa/*`.
- The Argo migrate job does not carry the secret-provider and Vault configuration that the server pods have.

So the knex migration cannot both move a value and blank it. If it blanked without moving, credentials would be lost. The work is therefore split:

**A. Runtime backfill unit, `migrateTenantProviderSecrets(knex, tenant, secretProvider)`, in `providerSecrets.ts`**
1. Read the row through `tenantDb(knex, tenant)`. Every statement is tenant-scoped, so Citus routes it to a single shard.
2. For each smtp/resend config holding plaintext, write the value to a new versioned reference. A literal `'***'` or an empty string counts as no value.
3. Conditional update: `UPDATE tenant_email_settings SET provider_configs = $new WHERE tenant = $t AND updated_at = $loaded`.
   - The condition is on `updated_at` because `json` (not `jsonb`) has no equality operator, so the column itself cannot be compared.
   - `updated_at` is **not** bumped. The reference change already moves the fingerprint.
4. If 0 rows were updated (a concurrent save won), delete the refs just written and report `skipped-concurrent`. The next run retries.
5. Idempotent: a row with no plaintext left is a no-op.
6. Returns `{ tenant, migrated: ['smtp.password', …], skipped }` and **never values**.

**B. Operator script `server/scripts/backfill-tenant-email-secrets.ts`**
- Modeled on `server/scripts/contract-template-decoupling.ts`. Runs in a hosted server pod with that pod's secret configuration (`kubectl exec … npx tsx scripts/backfill-tenant-email-secrets.ts [--dry-run] [--tenant <id>]`).
- Lists tenants with `select tenant from tenant_email_settings`. This is a multi-shard read and fine for a script.
- Processes tenants one at a time, so the Vault per-tenant read-merge-write never races itself.
- Prints counts per tenant. `--dry-run` reports which tenants and fields hold plaintext, without values.
- Exits non-zero if any tenant fails.

**C. Opportunistic migration on save**
`persistProviderSecrets` migrates legacy plaintext for any tenant that saves its settings (2.2), so active tenants clean themselves up.

**D. knex migration in this PR: `server/migrations/20261013120000_purge_tenant_email_settings_local_heap.cjs`**
- `tenant_email_settings` was rebuilt for Citus in Aug 2025 (`20250804000001_fix_primary_keys_for_citus.cjs:56, 210`). If it was distributed with existing rows, the coordinator's local parent heap still holds pre-distribution copies, including any plaintext passwords from that time. They are invisible to every query (gotcha 1 in citus-migration-gotchas). No app UPDATE can blank them.
- The migration runs the guarded `truncate_local_data_after_distributing_table('public.tenant_email_settings')`:
  - It runs only if `pg_dist_partition` exists and the table is distributed, so it is a no-op on CE / plain Postgres.
  - It is transactional and does not touch visible shard data.
  - It cascades to the local heaps of tables with foreign keys to this table. Confirm none exist (`pg_constraint` query in the PR). Any that do are stale leftovers too.
- `down` is a no-op.
- It does not depend on the backfill and can ship in the same release.
- Before merging, check production read-only with `SELECT pg_relation_size('tenant_email_settings'::regclass)` to confirm whether there is anything to purge.

**E. Follow-up release, separate PR, after B has run in production: `…_assert_no_plaintext_email_secrets.cjs`**
- Fails the migration with the offending tenant ids, not values, if any `provider_configs` element still has a non-empty `config.password`, `config.apiKey` or `config.api_key` other than `'***'`. Uses a `json_array_elements` query, routed tenant-scoped or as a multi-shard read.
- The same PR removes the legacy-plaintext read fallback from `resolveProviderSecrets`. From then on, plaintext is a hard error.
- It cannot ship in the same release as A–C, because migrations run before the new code (and therefore the backfill) is deployed.

**F. Ops steps (no code)**
- After B, run `VACUUM (VERBOSE) tenant_email_settings;` so the dead tuples that held the old plaintext are reclaimed rather than waiting for autovacuum.
- Values already in WAL archives and backups age out on the normal retention schedule. Rotating the credential is the only real fix for what is already exposed (see 6).

## 3. Ordering
1. Add `providerSecrets.ts` with unit tests.
2. Wire the read path: `EmailProviderManager.resolveProviderConfig` and the legacy fallback.
3. Wire the write path: `updateEmailSettings` reordering, `persistProviderSecrets`, redaction in `getEmailSettings`.
4. Add the backfill unit (`migrateTenantProviderSecrets`) and the operator script.
5. Add the knex local-heap purge migration (D).
6. Update the UI comment, then run tests.
7. **Before deploying to production (blocking):** confirm that every process that sends tenant mail can *read* tenant secrets from Vault. That means server pods, `workflow-worker` (`readChain env,vault,filesystem`), `temporal-worker` (`env,filesystem,vault`, but its Vault role and path are `temporal-worker`-scoped) and `email-service`. The tenant path template `kv/data/tenants/{tenantId}/secrets` must be allowed by each one's Vault policy and set in each one's `VAULT_TENANT_SECRET_PATH_TEMPLATE`. Today a failure here is hidden, because Resend's tenant-secret lookup is a fallback that swallows errors. After this change it would break SMTP sending from workers. The fail-fast error in 2.2 makes such a break loud rather than silent.
8. Deploy, run B with `--dry-run` and then for real, then run F (VACUUM).
9. Follow-up release: E.
10. Ask SMT-Tech to rotate the SMTP password (6).

## 4. Tests
Unit tests, Vitest, beside the existing ones:
- `packages/email/src/__tests__/providerSecrets.test.ts`
  - Persist: a new value creates a versioned reference and strips plaintext.
  - `'***'` keeps the existing reference.
  - Empty string clears the reference and queues it for deletion.
  - Legacy plaintext with `'***'` incoming migrates it.
  - The `api_key` alias is stripped.
  - Secret names never include `providerId` and pass `validateSecretComponent`.
  - Resolve: a reference resolves to its value; a missing secret throws `EMAIL_PROVIDER_SECRET_MISSING`; legacy plaintext passes through with a warning.
  - Redact: no secret field, alias or `secretRefs` survives, and the mask reflects presence.
- `packages/email/src/providers/__tests__/EmailProviderManager.secrets.test.ts`
  - The SMTP provider is initialized with the resolved password.
  - Resend with a reference does **not** consult the env or app fallback.
  - Resend with nothing falls back as it does today.
- Extend `packages/integrations/src/actions/email-actions/emailSettingsActions.providers.test.ts`:
  - Save writes the secret to the mocked provider and the persisted `provider_configs` JSON contains no password or apiKey.
  - A failed DB transaction deletes the newly written reference.
  - A rejected validation never calls `setTenantSecret`.
  - The responses from `getEmailSettings` and `updateEmailSettings` contain no secret, no `secretRefs`, and no value equal to the secret (deep scan of the serialized result).
- Extend `packages/email/src/__tests__/TenantEmailService.settingsFreshness.test.ts`: a reference rotation rebuilds the provider.

DB integration test (real Postgres, following the integration-testing skill):
- `server/src/test/integration/tenantEmailSecretsBackfill.integration.test.ts`
  - The backfill migrates and blanks.
  - It is idempotent on a second run.
  - When `updated_at` moved concurrently, the conditional update skips and the orphaned ref is deleted.
  - Uses a filesystem secret provider pointed at a temp dir.

Migration D: run it on plain Postgres in CI (the no-op path). For the Citus path, do a manual check in the `citus-test` single-node scratch DB, following the skill's repro recipe.

## 5. Out of scope
- Inbound providers' (IMAP/Gmail) secrets in `email_provider_configs`, `imap_email_provider_config` and similar. The workflow-harness fixture still carries `password: 'imap_pass'`. These deserve a separate audit card.
- Deleting tenant secrets from the secret provider when a tenant is deleted (`tenant-deletion-activities.ts` drops DB rows only). This gap is shared by every integration that uses `setTenantSecret`.
- `payment_provider_configs` and other `*_configs` JSON columns.
- Replacing the in-band `'***'` sentinel with an explicit `{ hasPassword: boolean }` view model. A user whose real password is literally `***` cannot set it; that limitation already exists today.
- Vault KV read-merge-write lost-update races between *different* integrations writing the same tenant at the same moment. This is a pre-existing provider issue; it should be fixed in `VaultSecretProvider` with CAS, not here.

## 6. Risks
- **Workers that cannot read Vault tenant paths** (3, step 7). This is the main deployment risk: after the backfill, SMTP mail sent from workflow or temporal workers would fail with `EMAIL_PROVIDER_SECRET_MISSING`. Mitigations:
  - the blocking pre-deploy check;
  - the error is loud and actionable;
  - E (removing the plaintext fallback) waits until production has been observed.
- **CE / on-prem with filesystem writes:** a secret written by the server container must be readable by other mail-sending containers. Confirm that `SECRET_FS_BASE_PATH` is a shared volume across the services in `docker-compose.ce.yaml` and on the appliance. If it is not, CE tenants keep plaintext via the legacy fallback until it is shared. E must not ship for CE until it is.
- **Secret written but DB write failed:** handled by versioned references plus the `committedRefs` cleanup. Worst case is an orphaned secret, never a changed live credential.
- **Concurrent save versus backfill:** handled by the conditional update on `updated_at`.
- **Exposure in logs:** new code logs secret *names* and field labels only. Tests assert that no value appears in the action responses. `SMTPEmailProvider` and `ResendEmailProvider` already avoid logging config.
- **Exposure that has already happened:** the SMT-Tech password appeared in an investigation transcript and sits in DB backups and WAL. Code cannot undo that. **Follow-up: SMT-Tech must rotate their SMTP password after this ships**, then re-enter it in Outbound Email settings. The new value goes only to the secret store. Track this on PSA ticket alga-2026-0002693.
