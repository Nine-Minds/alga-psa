# IMAP OAuth state signing key

IMAP OAuth initiation and callback require the application secret
`OAUTH_STATE_SIGNING_KEY`. The key signs the short-lived, single-use state
grant. Missing or unreadable configuration intentionally fails closed: OAuth
initiation fails rather than issuing unsigned state.

Generate one high-entropy value per environment and store it with the existing
secret provider. Never commit it, put it in a checked-in values file, or print
it. Every instance handling initiation or callback in an environment must read
the exact same value; per-instance keys make cross-instance callbacks fail
signature validation.

## Provision through a supported provider

- **Environment provider:** inject `OAUTH_STATE_SIGNING_KEY` into the server
  container environment from the deployment secret manager. Prebuilt Compose
  server configuration passes through that host variable when it is present;
  it does not require or mount a signing-key file. With `SECRET_ENV_PREFIX`,
  inject `<PREFIX>_OAUTH_STATE_SIGNING_KEY` instead and configure that prefix.
  For prebuilt Compose, add that prefixed variable to the server's environment
  in a deployment override; the shared configuration passes through only the
  unprefixed key.
- **Filesystem provider:** create an application secret file named
  `OAUTH_STATE_SIGNING_KEY` directly in the configured secret root
  (`SECRET_FS_BASE_PATH`; otherwise the provider uses `/run/secrets` when
  mounted, then `<cwd>/secrets`). Application secrets are direct children of
  the root; `tenants/<tenantId>/` is only for tenant secrets. Prebuilt CE and EE
  Compose stacks mount this key only when the opt-in overlay
  `docker-compose.prebuilt.oauth-state-signing-key.yaml` is included. Provision
  the file once on the host before bringing up the stack, for example:

  ```bash
  umask 077
  openssl rand -hex 32 > secrets/OAUTH_STATE_SIGNING_KEY
  chmod 600 secrets/OAUTH_STATE_SIGNING_KEY
  ```

  Include the overlay after the edition file in each `docker compose` command:
  `-f docker-compose.prebuilt.base.yaml -f docker-compose.prebuilt.ce.yaml -f docker-compose.prebuilt.oauth-state-signing-key.yaml`
  (use `docker-compose.prebuilt.ee.yaml` for EE). Without that overlay, the
  prebuilt Compose stack does not reference or require this file.

  For multiple hosts/instances, distribute the same managed value securely;
  never generate independently on each host.
- **Vault provider:** write a string field named `OAUTH_STATE_SIGNING_KEY` to
  the KV v2 application-secret document at `VAULT_APP_SECRET_PATH`. Configure
  `SECRET_READ_CHAIN=env,vault` (or another deliberate chain that includes
  `vault`) plus `VAULT_ADDR`, `VAULT_TOKEN`, `VAULT_APP_SECRET_PATH`, and
  `VAULT_TENANT_SECRET_PATH_TEMPLATE` on every instance. Both paths are
  required to initialize the provider, including when reading only an
  application secret. For example, use `kv/data/app/secrets` and
  `kv/data/tenants/{tenantId}/secrets` for a KV v2 mount named `kv`.
  The shared prebuilt server configuration forwards these settings; no
  signing-key file or filesystem overlay is required.

The provider supports `env`, `filesystem`, and `vault`. Composite reads use the
first provider returning a value, so ensure the intended provider contains the
key. See the [Docker secret provider configuration](config/DOCKER_SECRET_PROVIDER_CONFIG.md)
and [Helm secret provider configuration](config/HELM_SECRET_PROVIDER_CONFIG.md).

## Verify prebuilt wiring without starting services

From the repository root, render the chosen stack and inspect only the server
secret target. Do not add the filesystem overlay for environment or Vault
providers. This filter avoids printing unrelated resolved environment values:

```bash
docker compose -f docker-compose.prebuilt.base.yaml \
  -f docker-compose.prebuilt.ce.yaml --env-file server/.env config --format json |
  jq '{serverSigningKeyMounts: [.services.server.secrets[]? | select(.target == "OAUTH_STATE_SIGNING_KEY")]}'
```

Use `docker-compose.prebuilt.ee.yaml` for EE. Without the filesystem overlay,
the expected mount list is empty. Add `-f docker-compose.prebuilt.oauth-state-signing-key.yaml`
to verify filesystem mode; the expected target is
`/run/secrets/OAUTH_STATE_SIGNING_KEY`. This static check verifies repository
configuration only, not an actual host file or running server.

To verify environment mode without printing the signing key, render with the
deployment secret manager's environment injection enabled and check only key
presence. Avoid saving or sharing unfiltered `docker compose config` output,
because resolved environment values can be included:

```bash
docker compose -f docker-compose.prebuilt.base.yaml \
  -f docker-compose.prebuilt.ce.yaml --env-file server/.env config --format json |
  jq '{environmentKeyPassedThrough: (.services.server.environment.OAUTH_STATE_SIGNING_KEY != null and .services.server.environment.OAUTH_STATE_SIGNING_KEY != ""),
       signingKeyMounts: [.services.server.secrets[]? | select(.target == "OAUTH_STATE_SIGNING_KEY") | .target]}'
```

The pass-through setting is optional and absent from the container when the
host environment has no value. Vault mode is selected through the existing
`SECRET_READ_CHAIN` and Vault configuration variables; the same filtered
configuration check can confirm provider selection without printing the
Vault token. These are config-resolution checks, not proof that deployment
secret stores or Vault contain the key.

Check all required Vault settings without displaying their values:

```bash
docker compose -f docker-compose.prebuilt.base.yaml \
  -f docker-compose.prebuilt.ce.yaml --env-file server/.env config --format json |
  jq '.services.server.environment | {
    readChain: .SECRET_READ_CHAIN,
    requiredVaultSettingsPresent: ([.VAULT_ADDR, .VAULT_TOKEN, .VAULT_APP_SECRET_PATH,
      .VAULT_TENANT_SECRET_PATH_TEMPLATE] | all(. != null and . != ""))
  }'
```

Repeat for EE. An isolated verification of the rendered CE and EE environment
initialized the real application secret provider against a local Vault KV v2
simulator and resolved both the signing key and a tenant secret. It also
confirmed that omitting the tenant path prevents initialization. This checks
configuration and provider behavior, not a deployment's Vault access or data.

To verify the actual application filesystem provider against the local secret
root, without displaying the value or starting the app server:

```bash
SECRET_READ_CHAIN=filesystem SECRET_FS_BASE_PATH="$PWD/secrets" npx tsx -e \
  "import('./packages/core/src/lib/secrets/secretProvider.ts').then(async ({getSecretProviderInstance}) => { const value = await (await getSecretProviderInstance()).getAppSecret('OAUTH_STATE_SIGNING_KEY'); if (!value?.trim()) process.exit(1); console.log('OAUTH_STATE_SIGNING_KEY resolves through the filesystem provider'); })"
```

This proves only resolution from that local directory. Operators must verify
the mount and secret resolution on each actual server instance using their
deployment procedure without logging the value.

## Rollout order

1. Provision one environment-specific key through the chosen secret provider
   and make the same value available to every server instance.
2. Apply additive migration
   `server/migrations/20261101090000_create_email_oauth_grants.cjs` to the
   application database. It creates the tenant-scoped grant table and ensures
   tenant distribution idempotently where Citus is installed.
3. Deploy application code that requires the key and table. Confirm OAuth
   initiation and callback report no secret lookup errors; never log or compare
   the key itself.

Both key and migration must be ready before the application rollout. Rotating
the key invalidates outstanding OAuth attempts signed with the previous key;
users must restart those attempts. Missing/unreadable key makes initiation fail
closed and callbacks cannot validate state.

## Migration readiness evidence

The migration is timestamped `20261101090000` and is loaded from the standard
`server/migrations` directory. It creates a tenant-scoped primary key
`(tenant, id)` before calling `ensureTenantDistribution`. The isolated database
integration suite
`server/src/test/integration/emailOAuthGrants.integration.test.ts` bootstraps
the migration, re-runs it to check retry safety, then connects as the
application database role to insert and concurrently consume a grant. Exactly
one conditional consume returns a row. This is isolated database evidence; it
does not establish that a real deployment applied the migration, granted
application-role access, or provisioned the key.

The migration is additive. During rollback, keep the table and key in place
until no deployed code expects them. Rolling back application code can leave
in-flight signed attempts unusable; users can restart those attempts after a
compatible version is restored. Do not introduce a fallback key or drop grants
while callbacks may be in flight.
