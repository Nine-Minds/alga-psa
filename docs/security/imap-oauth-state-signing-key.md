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

- **Environment provider:** set `OAUTH_STATE_SIGNING_KEY` in the server
  container's secret-backed environment. With `SECRET_ENV_PREFIX`, use
  `<PREFIX>_OAUTH_STATE_SIGNING_KEY`.
- **Filesystem provider:** create an application secret file named
  `OAUTH_STATE_SIGNING_KEY` directly in the configured secret root
  (`SECRET_FS_BASE_PATH`; otherwise the provider uses `/run/secrets` when
  mounted, then `<cwd>/secrets`). Application secrets are direct children of
  the root; `tenants/<tenantId>/` is only for tenant secrets. The prebuilt CE
  and EE Compose stacks now define a Docker secret from
  `./secrets/OAUTH_STATE_SIGNING_KEY` and mount it into the server as
  `/run/secrets/OAUTH_STATE_SIGNING_KEY`. Provision the file once on the host
  before bringing up the stack, for example:

  ```bash
  umask 077
  openssl rand -hex 32 > secrets/OAUTH_STATE_SIGNING_KEY
  chmod 600 secrets/OAUTH_STATE_SIGNING_KEY
  ```

  For multiple hosts/instances, distribute the same managed value securely;
  never generate independently on each host.
- **Vault provider:** write a string field named `OAUTH_STATE_SIGNING_KEY` to
  the KV v2 application-secret document at `VAULT_APP_SECRET_PATH`. Configure
  `VAULT_ADDR`, `VAULT_TOKEN`, and `VAULT_APP_SECRET_PATH` on every instance.

The provider supports `env`, `filesystem`, and `vault`. Composite reads use the
first provider returning a value, so ensure the intended provider contains the
key. See the [Docker secret provider configuration](config/DOCKER_SECRET_PROVIDER_CONFIG.md)
and [Helm secret provider configuration](config/HELM_SECRET_PROVIDER_CONFIG.md).

## Verify prebuilt wiring without starting services

From the repository root, render the chosen stack and inspect only the secret
source and server target. This filter avoids printing unrelated resolved
environment values:

```bash
docker compose -f docker-compose.prebuilt.base.yaml \
  -f docker-compose.prebuilt.ce.yaml --env-file server/.env config --format json |
  jq '{source: .secrets.oauth_state_signing_key.file,
       serverSecret: [.services.server.secrets[] | select(.target == "OAUTH_STATE_SIGNING_KEY")]}'
```

Use `docker-compose.prebuilt.ee.yaml` for EE. Expected source:
the resolved host path under this checkout's `secrets/` directory; expected
container target: `/run/secrets/OAUTH_STATE_SIGNING_KEY`. This static check does not establish
that a deployment host has the file or that a running server can read it.

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
