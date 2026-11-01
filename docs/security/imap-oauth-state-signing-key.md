# IMAP OAuth state signing key

IMAP OAuth initiation and callback require the application secret
`OAUTH_STATE_SIGNING_KEY`. The key signs the short lived, single-use state
grant. Missing or unreadable configuration intentionally fails closed: OAuth
initiation will fail rather than issue unsigned state.

Generate a high entropy value once for each environment (for example,
`openssl rand -hex 32`) and store it using the deployment's existing secret
provider. Do not put the value in source control, a checked-in values file, or
logs. Every server instance that can handle initiation or callback in the same
environment must read the exact same value; independently generating a key per
replica makes callbacks routed to another replica fail signature validation.

## Provision through a supported provider

- **Environment provider:** set `OAUTH_STATE_SIGNING_KEY` in the server
  container's secret-backed environment. If `SECRET_ENV_PREFIX` is configured,
  use `<PREFIX>_OAUTH_STATE_SIGNING_KEY`. Keep the value in the orchestrator's
  secret store and inject the same value into every server instance.
- **Filesystem provider:** create an application secret file named
  `OAUTH_STATE_SIGNING_KEY` directly in the configured secret root
  (`SECRET_FS_BASE_PATH`; the default root is the deployment's `secrets`
  directory or `/run/secrets` when Docker secrets are mounted). Mount the same
  read-only file into every server instance. Application secrets are direct
  children of the root; the `tenants/<tenantId>/` directory is only for tenant
  secrets.
- **Vault provider:** write a string field named `OAUTH_STATE_SIGNING_KEY` to
  the KV v2 application-secret document at `VAULT_APP_SECRET_PATH`. Configure
  `VAULT_ADDR`, `VAULT_TOKEN`, and `VAULT_APP_SECRET_PATH` on every instance.
  With a composite read chain, ensure the key is present in the first provider
  that returns a value for that name; reads are first-value-wins.

The secret provider supports `env`, `filesystem`, and `vault`; see the
[Docker secret provider configuration](config/DOCKER_SECRET_PROVIDER_CONFIG.md)
and [Helm secret provider configuration](config/HELM_SECRET_PROVIDER_CONFIG.md)
for deployment wiring. Configure provider selection and access before the
application rollout, and verify each instance can resolve the key without
printing it.

## Rollout order

1. Apply migration `20261101090000_create_email_oauth_grants.cjs` to the
   application database. It creates the grant table and ensures tenant
   distribution idempotently where Citus is installed.
2. Provision one environment-specific signing key through the chosen secret
   provider and make the same value available to every server instance.
3. Roll out the application code. Confirm OAuth initiation and callback logs
   show no secret lookup errors; do not log or compare the key itself.

The migration is additive and can precede the application rollout. Existing
OAuth state issued before the code rollout will not validate after signing is
enabled; users can safely restart those in-progress authorization attempts.
