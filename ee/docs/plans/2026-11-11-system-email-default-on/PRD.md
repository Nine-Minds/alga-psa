# System email provider: on when configured, `EMAIL_ENABLE` only disables

Ticket: alga-2026-0002481

## Problem

The environment-backed system email provider is created only when `EMAIL_ENABLE` is exactly `'true'`. A service that has working mail credentials but no `EMAIL_ENABLE` silently has no system provider. The flag carries no information the credentials do not already carry, so it is a second switch that has to be remembered in every deployment of every service.

That is what broke workflow email on hosted. The `workflow-worker` service runs workflow v2 actions, including `email.send`. For a tenant on Alga's managed outbound mail (no enabled tenant provider), `EmailProviderManager` falls back to the system provider. The worker deployment has no email environment at all, so the fallback returns null and the step fails with "No enabled email provider configured". Production evidence: 7 failed `email.send` steps across 3 tenants over about 3.5 weeks, including one published date-triggered workflow failing on every weekly run. The workflow itself was built correctly.

Two defects compound:

1. The flag must be set to enable. Unset means off, even with credentials present.
2. The `ee/helm/workflow-worker` chart cannot render email settings. It has no email values, and `extraEnv` renders plain `name`/`value` only, so a secret-backed `RESEND_API_KEY` cannot be passed. The hosted values file carries a `resend:` block that no template reads.

## Goals

- The system email provider exists whenever it is configured. `EMAIL_ENABLE=false` is the only thing the flag does: it disables the provider.
- One place decides the system email state, and every reader uses it.
- The workflow-worker chart can be given system email settings, including the API key from a secret, in the same values shape the other charts use.
- A process with no email configuration and no flag behaves as it does today: no system provider, no error, no crash.

## Non-goals

- Changing tenant-level provider selection or the fallback order in `EmailProviderManager` / `TenantEmailService`.
- Changing `VERIFY_EMAIL_ENABLED`.
- Reworking `temporal-worker`'s separate `EMAIL_PROVIDER` / `RESEND_DEFAULT_FROM_*` variables.
- The hosted values change and worker redeploy in `nm-kube-config` (a different repository; see Rollout).

## Design

### One resolver

Add a single function in `packages/email/src/system/` (exported from the package) that reads the environment and returns the system email state:

- `disabled`: `EMAIL_ENABLE` is `'false'` (case-insensitive, trimmed).
- `unconfigured`: not disabled, and neither a Resend key nor an SMTP host is present. If `EMAIL_PROVIDER_TYPE` names a provider, that provider's credential must be present (`resend` needs `RESEND_API_KEY`, `smtp` needs `EMAIL_HOST`).
- `configured`: not disabled and credentials are present, with the resolved `providerType` (`EMAIL_PROVIDER_TYPE`, else `resend` when `RESEND_API_KEY` is set, else `smtp`).

Any `EMAIL_ENABLE` value other than `false` (unset, empty, `true`, anything else) is "not disabled".

### Readers move to the resolver

No reader compares `process.env.EMAIL_ENABLE` itself after this change.

- `SystemEmailProviderFactory.createProvider()`: returns null for `disabled` and `unconfigured`, with a distinct info log for each. Creates the provider for `configured`. Remove the `console.log` of the flag. A provider initialization failure with credentials present still throws, as today.
- `SystemEmailProviderFactory.getProviderConfigSummary()`: `enabled` reflects `configured`; report the state.
- `server/src/lib/validation/emailConfigValidation.ts` and the `initializeApp.ts` log: validate when `configured`; no warnings for `disabled` or `unconfigured`.
- `packages/auth/src/actions/useRegister.tsx`: the registration verification gate uses "system email is configured" instead of the raw flag.
- `getConfigFingerprint()` keeps hashing the raw value so a flag change still rotates the cached provider.

### Defaults stop saying "false"

With the flag disable-only, a default of `false` in deployment files would keep everything off. Remove the defaults so unset stays unset.

- `docker-compose*.yaml` (base, ce, ee, prebuilt variants, setup-ubuntu override): `${EMAIL_ENABLE:-false}` becomes a plain pass-through that leaves the variable empty when unset.
- `server/entrypoint.sh`: `EMAIL_ENABLE` is no longer a required variable. The entrypoint no longer requires `EMAIL_FROM` / `EMAIL_PORT` / `EMAIL_USERNAME` or a numeric `EMAIL_PORT` just because the flag is not `false` (that check already assumed default-on, and it rejects a Resend-only setup). Application-side validation covers misconfiguration with warnings.
- `.env.example`, `ee/setup/config.ini`, `compose.env`: drop the "Required: Boolean" framing; document the flag as an optional off switch.
- `scripts/workflow-runtime-v2-compose-smoke.mjs` and `.github/workflows/e2e-fresh-install-tests.yaml` set `false` explicitly and keep doing so.
- The app Helm chart renders `EMAIL_ENABLE` from `.Values.email.enabled` as `"true"`/`"false"`; behaviour is unchanged and it needs no edit.

### workflow-worker chart

Add an `email` values block to `ee/helm/workflow-worker`, matching the shape used by the app and temporal-worker charts:

```yaml
email:
  enabled: true          # false renders EMAIL_ENABLE=false
  provider: ""           # optional EMAIL_PROVIDER_TYPE
  from: ""               # EMAIL_FROM
  resendApiKeySecret:    # RESEND_API_KEY via secretKeyRef, optional: true
    name: ""
    key: RESEND_API_KEY
  smtp:                  # optional EMAIL_HOST / EMAIL_PORT / EMAIL_USERNAME, password via secretKeyRef
    host: ""
    port: ""
    username: ""
    passwordSecret: { name: "", key: "" }
```

The deployment template renders each variable only when its value is set. `EMAIL_ENABLE` is rendered only as `"false"` when `email.enabled` is false. Check the appliance releases (`ee/appliance/flux/base/releases/workflow-worker.yaml`, single-node profile values) and wire the same block from whatever the appliance app release uses for system email, so appliance workflow email does not depend on a tenant provider either.

Also let `extraEnv` entries carry `valueFrom` (render the entry with `toYaml`), so a secret-backed variable never again needs a chart change.

## Behaviour change to call out

A process that has mail credentials but no `EMAIL_ENABLE` starts sending system email after this change. That is the intent. On hosted this newly enables the system fallback in `temporal-worker`, which has `RESEND_API_KEY` and no flag. Self-hosted installs that left `EMAIL_ENABLE` unset while filling in SMTP settings will begin sending; installs that set `EMAIL_ENABLE=false` are unaffected.

## Rollout

1. Merge and deploy this change.
2. In `nm-kube-config`, replace the unused `resend:` block in `workflow-worker/hosted.values.yaml` with the new `email:` block (`provider: resend`, `from: noreply@algapsa.com`, `resendApiKeySecret: resend-credentials / RESEND_API_KEY`) and redeploy the workflow worker. This step is outside this repository and is done by Robert.
3. Published workflows that have been failing at `email.send` start sending on their next run. Before step 2, check which published workflows will begin emailing and tell their owners (see the ticket).

## Acceptance criteria

- With `RESEND_API_KEY` set and `EMAIL_ENABLE` unset, `createProvider()` returns a Resend provider.
- With `EMAIL_HOST` set and `EMAIL_ENABLE` unset, `createProvider()` returns an SMTP provider.
- With `EMAIL_ENABLE=false` and credentials set, `createProvider()` returns null.
- With no credentials and no flag, `createProvider()` returns null and does not throw.
- `git grep "process.env.EMAIL_ENABLE"` finds only the resolver, the fingerprint, and tests.
- `helm template ee/helm/workflow-worker` with the `email` block set renders `EMAIL_PROVIDER_TYPE`, `EMAIL_FROM`, and `RESEND_API_KEY` as a `secretKeyRef`; with defaults it renders no email variables.
- A workflow `email.send` step for a tenant with no enabled tenant provider succeeds through the system provider when the worker has system email credentials and no `EMAIL_ENABLE`.
- A compose stack started with no `EMAIL_ENABLE` and no mail settings boots without entrypoint errors.
