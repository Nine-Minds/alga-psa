# Appliance: share tenant secrets with Temporal worker for Microsoft email polling

Card: `7843964e-5736-4a16-96e3-98875e41b9b9`
Branch: `feature/appliance-share-tenant-secrets-with-temporal-wor`

## Problem & confirmed root cause

On the single-node appliance, a Microsoft mailbox whose webhook validation timed out correctly
falls back to `delivery_mode=polling`. The 3-minute polling reconciliation runs in **temporal-worker**
and fails every run with `ms_email_provider_not_found`.

The provider is pinned to Microsoft profile `075068e7-1af6-47dd-b416-63a52b25fd18`. The profile row
passes lookup / archived / capability checks; the failure is at **client-secret resolution**.

Grounded chain (verified in code):

- `shared/services/email/microsoftEmailProviderConfig.ts` → `resolveProviderPinnedProfileCredentials`
  (lines ~103–141) calls `getSecretProviderInstance().getTenantSecret(tenant, profile.client_secret_ref)`.
  `client_secret_ref` = `microsoft_profile_<profileId>_client_secret`. If the read is empty it returns
  `null`, and `buildMicrosoftEmailProviderConfig` (lines ~216–218) throws
  `ms_email_provider_not_found`. Fail-closed, no fallback for pinned profiles.
- The provider is the filesystem provider `packages/core/src/lib/secrets/LazyFileSystemSecretProvider.ts`.
  Base path = `SECRET_FS_BASE_PATH` if set, else falls back to `/run/secrets` (pod-local Docker default),
  else `<cwd>/secrets`. Tenant path = `<basePath>/tenants/<tenant>/<secretName>`.
- Alga Core writes the profile secret into the **shared appliance hostPath**
  `/var/lib/alga-appliance/tenant-secrets`, mounted at `/shared-tenant-secrets`, with
  `SECRET_FS_BASE_PATH=/shared-tenant-secrets`. email-service mounts the same hostPath the same way.
- **temporal-worker does neither** — its chart has no `sharedTenantSecrets` block, no hostPath mount,
  and no `SECRET_FS_BASE_PATH`. So it resolves the base path to `/run/secrets` and reads
  `/run/secrets/tenants/<tenant>/microsoft_profile_<profile>_client_secret` — a pod-local path the
  secret was never written to. Hence the observed log and the reconcile failure.

**Fix in one line:** give temporal-worker the same shared-tenant-secret mount + `SECRET_FS_BASE_PATH`
that Alga Core and email-service already use, disabled by default so hosted rendering is unchanged.

## Reference convention (already implemented for Alga Core & email-service)

Chart values (both charts):
```yaml
sharedTenantSecrets:
  enabled: false
  hostPath: /var/lib/alga-appliance/tenant-secrets
  mountPath: /shared-tenant-secrets
```
Deployment template renders, gated on `sharedTenantSecrets.enabled`:
- a `hostPath` volume (`type: DirectoryOrCreate`),
- a `volumeMount` at `mountPath`,
- env `SECRET_FS_BASE_PATH = mountPath`.

Appliance Flux values (`alga-core.single-node.yaml`, `email-service.single-node.yaml`) only flip
`sharedTenantSecrets.enabled: true` and inherit the default paths. Both charts mount **read-write**
(no `readOnly`) — Alga Core writes, email-service reads, both via RW.

temporal-worker chart today: `ee/helm/temporal-worker/` has only generic `extraVolumes`/`extraVolumeMounts`/
`extraEnv` pass-throughs and no secret-provider env wiring.

## Implementation steps

### 1. temporal-worker chart values — `ee/helm/temporal-worker/values.yaml`
Add, mirroring email-service (default disabled → hosted unchanged):
```yaml
sharedTenantSecrets:
  enabled: false
  hostPath: /var/lib/alga-appliance/tenant-secrets
  mountPath: /shared-tenant-secrets
  readOnly: true        # see Decision D1
```

### 2. temporal-worker chart template — `ee/helm/temporal-worker/templates/deployment.yaml`
Add three conditional blocks gated on `.Values.sharedTenantSecrets.enabled`:
- **env** (in the main env list, alongside the existing entries):
  ```yaml
  - name: SECRET_FS_BASE_PATH
    value: "{{ .Values.sharedTenantSecrets.mountPath }}"
  ```
- **volumeMount** (in the container `volumeMounts:` list, before the `extraVolumeMounts` `with`):
  ```yaml
  - name: shared-tenant-secrets
    mountPath: {{ .Values.sharedTenantSecrets.mountPath }}
    {{- if .Values.sharedTenantSecrets.readOnly }}
    readOnly: true
    {{- end }}
  ```
- **volume** (in the pod `volumes:` list, before the `extraVolumes` `with`):
  ```yaml
  - name: shared-tenant-secrets
    hostPath:
      path: {{ .Values.sharedTenantSecrets.hostPath }}
      type: DirectoryOrCreate
  ```

### 3. Enable on the appliance — `ee/appliance/flux/profiles/single-node/values/temporal-worker.single-node.yaml`
Add:
```yaml
# Share the tenant-secret store with alga-core so the pinned Microsoft profile
# client secret alga-core writes via the filesystem provider is readable here,
# letting polling reconciliation resolve client_secret_ref.
sharedTenantSecrets:
  enabled: true
```
Inherits default hostPath/mountPath — same host directory and mount convention as Alga Core and
email-service on this node.

### 4. Read-chain sanity (companion to the mount)
Setting `SECRET_FS_BASE_PATH` only helps if `filesystem` is in the worker's read chain.
- With `SECRET_READ_CHAIN` unset, the Node legacy default is `['env','filesystem']` (write `filesystem`) —
  filesystem is present. The appliance flux file sets no `SECRET_READ_CHAIN`, so the default applies.
- Action: confirm the effective read chain includes `filesystem` for temporal-worker on the appliance
  (and that Alga Core/email-service appliance config, if they set `SECRET_READ_CHAIN` explicitly, is
  matched). `startupValidation.ts` already validates `SECRET_READ_CHAIN`/`SECRET_WRITE_PROVIDER`/
  `SECRET_FS_BASE_PATH` at boot, so a misconfig surfaces at worker startup, not silently at reconcile.

### 5. Flux rollout & upgrade note (step 4 of brief)
- Changing the HelmRelease values (chart bump + flux values) alters the Deployment pod spec
  (new volume, volumeMount, env), which triggers a normal rollout on reconcile — no manual restart.
- The `configmap.yaml` `checksum/config` annotation won't change (env/volumes live in the Deployment),
  so the rollout is driven by the pod-spec diff itself, which is sufficient.
- Upgrade considerations to document:
  - hostPath `/var/lib/alga-appliance/tenant-secrets` is created by `DirectoryOrCreate` if absent, but
    on a real appliance it already exists (Alga Core/email-service use it).
  - Recovery is automatic: once the mount is present and Alga Core has written the profile secret, the
    next 3-minute poll resolves it — no reconnect required (the error's "reconnect" advice cannot fix a
    cross-pod visibility gap and is misleading here).
  - No data migration; secret material is untouched.

### 6. Audit other worker tenant-secret readers (step 5 of brief)
All worker secret consumers already go through the single `getSecretProviderInstance()` singleton, so
they automatically honor the new `SECRET_FS_BASE_PATH` once set. Verify (read-only audit, no code change
expected beyond confirming) that none copy secret material into SQL columns or logs:
- `MicrosoftGraphAdapter` (legacy fallback reads `microsoft_client_*`) —
  `shared/services/email/providers/MicrosoftGraphAdapter.ts`
- `GmailAdapter` (`google_client_id/secret`)
- IMAP OAuth / IMAP password — `imapOauthToken.ts`, `unifiedInboundEmailQueueJobProcessor.ts`
- Microsoft/Google Calendar adapters
- `email-service.ts` (Resend, app secret)
- **Writer/deleter:** `ee/temporal-workflows/src/activities/tenant-deletion-activities.ts` (~1850) resolves
  the provider to **purge** tenant secrets → this is a *write/delete* path. See Decision D1.
- Confirm reconcile/adapter logging never prints `client_secret` / resolved secret values.

## Decisions to resolve during implementation

**D1 — read-only vs read-write mount.** The brief prefers read-only unless writes are required.
temporal-worker's polling path is read-only. **But** `tenant-deletion-activities` purges tenant secrets
through the same provider. If tenant deletion runs on the appliance and targets the shared store, a
read-only mount would break the purge (silent orphaned secrets or a delete error).
- Recommendation: ship `readOnly: true` for the polling fix, and in the audit (step 6) empirically
  determine whether tenant-deletion's secret purge executes on the appliance against the shared hostPath.
  If it does, either (a) set `sharedTenantSecrets.readOnly: false` on the appliance (matching Alga Core /
  email-service, which are RW), or (b) keep read-only and route the purge so the writer (Alga Core) owns
  deletion. The `readOnly` value key makes this a one-line flip without a template change.
- Default in chart values: `readOnly: true` (safest hosted default; only the appliance opts into the mount at all).

**D2 — chart version bump.** Bump `ee/helm/temporal-worker/Chart.yaml` version so Flux/registry pick up
the change cleanly. Confirm the appliance flux pipeline (nm-kube-config / Argo) references the chart by
a moving tag or needs the bump.

## Testing (behavioral only — no source-string assertions)

The repo has **no** helm render / helm-unittest harness today; the only existing "helm tests" are
`readFileSync` + `toContain` string assertions, which the acceptance criteria forbid. We introduce
render-based coverage.

### T1 — Helm rendering (behavioral, net-new harness)
Add a vitest test (in the `server` suite or a small dedicated one) that shells out to
`helm template ee/helm/temporal-worker ...`, parses the rendered YAML (`yaml` lib), selects the
Deployment, and asserts on the **rendered object graph**, not file text:
- With `--set sharedTenantSecrets.enabled=true`: the Deployment has a `shared-tenant-secrets` hostPath
  volume with `path=/var/lib/alga-appliance/tenant-secrets`, a matching container volumeMount at
  `/shared-tenant-secrets` (with `readOnly` per D1), and an env entry
  `SECRET_FS_BASE_PATH=/shared-tenant-secrets`.
- Default render (`enabled=false`, i.e. hosted): **none** of those appear → hosted/default rendering
  unchanged (locks the "no change when disabled" acceptance criterion).
- Render the appliance flux values overlay and assert `enabled: true` produces the mount.
- `helm` is available on PATH here (`/snap/bin/helm`); guard the test to skip with a clear message if the
  binary is absent in CI, or add helm to the CI image.

### T2 — Runtime/integration (temporal + real filesystem provider)
Use the established `ee/temporal-workflows` vitest + `@temporalio/testing` patterns.
- **Seam test (primary):** drive `resolveProviderPinnedProfileCredentials` / `buildMicrosoftEmailProviderConfig`
  against a **real** `LazyFileSystemSecretProvider` with `SECRET_FS_BASE_PATH` pointed at a temp dir.
  - Write `tenants/<tenant>/microsoft_profile_<profile>_client_secret` into the temp dir + a stub
    `microsoft_profiles` row → assert resolution succeeds and **no** `ms_email_provider_not_found`.
  - Omit the file → assert it throws `ms_email_provider_not_found` (reproduces the bug), proving the
    mount/base-path is the fix, not luck.
- **Reconcile test:** exercise `reconcilePollingMicrosoftProvidersActivity` /
  `EmailWebhookMaintenanceService.reconcilePollingProviders` with the provider present → assert success
  and that it would advance `last_reconciliation_at` (mock DB write asserted).
- Assert no test log line contains the secret value (guards the "never printed" criterion).

### T3 — Appliance acceptance (manual/VM, via `alga-appliance-local`)
On the libvirt appliance VM after Flux reconciles:
- Microsoft provider in `delivery_mode=polling` completes reconciliation without
  `ms_email_provider_not_found`; `last_reconciliation_at` advances on the 3-minute schedule.
- Send a controlled inbound Microsoft message while webhook delivery is unavailable → it is discovered,
  queued, processed, and produces the expected ticket/comment.
- Verify no secret value landed in DB fields or logs.

## Acceptance criteria mapping
- Worker resolves the profile secret written by Alga Core via shared FS store → steps 1–4, T2, T3.
- Polling reconcile completes, `last_reconciliation_at` advances → T2 reconcile test, T3.
- Controlled inbound message → ticket/comment while webhook down → T3.
- Secrets never printed / in DB / in manifests → step 6 audit, T1 (hostPath only, no secret in YAML),
  T2/T3 log assertions.
- Hosted/default Helm rendering unchanged when disabled → chart default `enabled: false`, T1 default-render.
- Behavioral Helm + runtime coverage, no source-string assertions → T1 (render+parse), T2 (real provider).

## Out of scope
Public Nginx/custom-domain webhook validation timeout (the reason polling was selected) — tracked
separately. This card makes the supported polling fallback actually work.

## Files to touch
- `ee/helm/temporal-worker/values.yaml` (add `sharedTenantSecrets`)
- `ee/helm/temporal-worker/templates/deployment.yaml` (volume, volumeMount, env)
- `ee/helm/temporal-worker/Chart.yaml` (version bump — D2)
- `ee/appliance/flux/profiles/single-node/values/temporal-worker.single-node.yaml` (enable)
- New: Helm render test (T1) + temporal filesystem-provider test (T2)
- Read-only audit pass (step 6) — likely no edits, confirm logging/DB hygiene

## Implementation decisions and verification (2026-08-25)

### D1 — retain the read-only appliance mount

The appliance temporal-worker does execute tenant-deletion workflows because its configured queue
includes `tenant-workflows`. The audited `tenant-deletion-activities.ts`, however, contains no
tenant-secret purge/delete path (the noted line near 1850 reads the Stripe **app** secret only).
The worker email, IMAP, calendar, and email-service consumers use `getSecretProviderInstance()` for
secret reads; none persist resolved values to SQL or log them. Polling reconciliation is read-only.
Therefore the appliance overlay retains the chart default `sharedTenantSecrets.readOnly: true`.
If tenant-deletion later gains a filesystem-secret purge activity, route that operation through the
Alga Core writer or explicitly set the appliance overlay to `readOnly: false` with a corresponding
write-path test.

### D2 — chart and Flux version bump

The appliance Flux HelmRelease pins `temporal-worker` to an exact chart version (`0.1.0`), rather
than a moving tag. The chart and HelmRelease are both bumped to `0.1.1`; publishing the OCI chart and
the updated appliance configuration bundle is required for an appliance upgrade to consume this
change. No additional nm-kube-config reference was found in this checkout.

### Read chain and rollout

The appliance values do not set `SECRET_READ_CHAIN` or `SECRET_WRITE_PROVIDER`. In the Node legacy
branch used when both are unset, `getSecretProviderInstance()` configures `['env', 'filesystem']`
and a filesystem writer, so the mounted base path is reachable without restructuring provider
configuration. Startup validation still validates explicit provider settings when they are supplied.

The HelmRelease values change and chart update alter the Deployment pod spec (the volume, mount, and
`SECRET_FS_BASE_PATH` env), so Flux performs the normal rollout on reconcile; no manual restart or
data migration is needed. The ConfigMap checksum also changes because the chart-version label is part
of the rendered ConfigMap. Once Alga Core has written the profile secret, the next three-minute poll
recovers automatically; reconnecting does not repair a cross-pod visibility gap.

### Tests and remaining manual acceptance

T1 is a rendered-object Helm test in
`ee/temporal-workflows/src/__tests__/temporal-worker-shared-tenant-secrets.helm.test.ts`; it covers
enabled values, disabled/default values, and the appliance overlay without source-string assertions.
T2 is a real filesystem-provider seam plus reconcile activity test in
`ee/temporal-workflows/src/activities/__tests__/microsoft-email-filesystem-secret-provider.test.ts`.
It confirms a secret at `SECRET_FS_BASE_PATH/tenants/<tenant>/<ref>` resolves the pinned profile,
an absent file produces `ms_email_provider_not_found`, and the test log capture excludes the dummy
secret value.

`helm template` before/after default-render sanity check found no shared-secret objects when disabled.
The only full-manifest differences are the required `0.1.0` → `0.1.1` chart labels and the derived
ConfigMap checksum; this is expected from D2, not a hosted secret-mount behavior change.

T3 remains pending human/libvirt appliance-VM acceptance: wait for Flux reconciliation, verify the
three-minute polling reconciliation advances, then exercise controlled inbound Microsoft mail while
webhook delivery is unavailable and inspect logs/database for secret leakage.

### Mitigation round (2026-08-26)

Re-verified the branch at chart 0.1.3 / HelmRelease 0.1.3 (dossier state, superseding the 0.1.1 note
above) and ran the T1/T2 suites under `vitest.no-docker.config.ts`; all pass. Confirmed by direct
`helm template` that the hosted/default render carries no `shared-tenant-secrets` volume, mount, or
`SECRET_FS_BASE_PATH` and keeps a two-label selector, while the appliance overlay renders the
`/var/lib/alga-appliance/tenant-secrets` hostPath (read-only) at `/shared-tenant-secrets` with
`SECRET_FS_BASE_PATH=/shared-tenant-secrets` and the legacy component selector label — the selector
addition is values-driven through `extraSelectorLabels`, never baked into the default template.

Step-6 audit surfaced one consumer that did log resolved secret material:
`GmailAdapter.registerWebhookSubscription` emitted the entire `provider_config` (including
`client_secret` and OAuth tokens) via `console.log` on the Gmail watch-recovery path
(`shared/services/email/providers/GmailAdapter.ts`). Removed the dump and added
`gmail-adapter-secret-log-hygiene.test.ts` asserting no captured log line contains the secret value.
Non-vacuity verified: re-adding the dump fails the test, removing it passes. No consumer writes a
resolved secret to SQL; the only secret-like values persisted are OAuth session tokens
(access/refresh), which is standard OAuth storage, not filesystem secret material. Confirmed
`tenant-deletion-activities.ts` reads only the Stripe app secret and has no filesystem tenant-secret
purge path, so the read-only appliance mount (D1) stays correct.

Flux/Helm owns the rendered pod specification; the Deployment must never be patched by hand. The
HelmRelease's install/upgrade remediation `retries: 0` mean an upgrade that reaches a Failed state is
not retried and the HelmRelease sits Stalled. If that happens during an appliance upgrade, retry
reconciliation with the annotation pair already used by `host-service/manage-engine.mjs`
(`reconcile.fluxcd.io/requestedAt=<ISO-8601>` first; add `reconcile.fluxcd.io/forceAt` only if a fresh
revision must be forced) — never edit the live Deployment. Because the selector addition is delivered
through `extraSelectorLabels` in the values overlay rather than the default template, hosted
Deployments (two-label selector) and the appliance Deployment (three-label selector) both upgrade in
place without an immutable-selector migration failure.
