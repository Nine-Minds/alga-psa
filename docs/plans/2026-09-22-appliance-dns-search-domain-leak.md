# Appliance DNS isolation and persistent installation failures

Implementation plan, 2026-09-22. Card: `8df74f69-0292-46e4-bc62-ec9bbdc0b38c`.

## Outcome and evidence

Generate cluster resolver configuration without host search domains, retain actionable installation failures during bounded retries, and give licensing the registry transport's explicit resolver behavior. Implement in that priority order. This is a plan only; verification below is work for Draft Implementation and validation.

The reported incident establishes four facts (customer identifiers intentionally omitted):

- DHCP supplied a search domain with a wildcard record. Pod `ndots:5` caused ordinary hostname lookup to select that wildcard address before the intended public name. Direct DNS queries returned the correct public address; TLS against the wildcard destination failed with `ERR_SSL_TLSV1_UNRECOGNIZED_NAME`.
- A search-free k3s resolver file and `resolv-conf` drop-in fixed redemption. Existing Flux source-controller pods still failed until restarted. Configuration changes must therefore cover existing pods as well as future pods.
- Registry requests use `setup-engine.mjs:httpsRequest` → `resolverLookup` → `resolveAddressesWithServers`; licensing uses `install-code.mjs:redeemInstallCode` → global `fetch`. A healthy registry probe does not prove licensing works.
- `server.mjs:reconcileBlockedSetup` clears retry state whenever the current state is not blocked, including running states. Engine phase writes replace install state, and `queueSetupWorkflow` discards output. Together these erase evidence and prevent the cap from engaging.

## 1. Own cluster DNS at bootstrap, including upgrades

### Shared configuration and initial boot

Current owner: `ee/appliance/scripts/bootstrap-control-plane.sh:configure_k3s_storage_owner` writes `/etc/rancher/k3s/config.yaml.d/20-alga-local-storage.yaml`. Its main dispatch calls this before `ensure_k3s_started`; `--control-plane-only` skips it entirely.

Add a reusable host DNS configuration script, proposed `ee/appliance/scripts/configure-k3s-dns.sh`, and call it from bootstrap before starting k3s and from the control-plane-only branch. Keep resolver selection, validation, file generation, and change detection in this one implementation. Add testable path overrides and `--dry-run`, with production defaults fixed to the host paths below.

1. Read persisted setup inputs (default `/var/lib/alga-appliance/setup-inputs.json`) using a JSON parser, never shell evaluation. For `dnsMode: custom`, use only validated `dnsServers`. Before inputs exist, or for automatic mode, read nameservers from `/run/systemd/resolve/resolv.conf`. If that file is absent on a non-systemd-resolved host, accept non-loopback nameservers from host `/etc/resolv.conf`; do not copy its search/options lines. Never substitute public DNS silently.
2. Validate literal IPv4/IPv6 addresses, deduplicate while preserving order, and reject loopback/stub addresses, including `127.0.0.53` and `::1`. Empty/invalid custom input or no usable upstream must produce an explicit DNS configuration failure and retain the last valid files. Do not install an empty resolver file or use a pod's cluster DNS service as the host upstream.
3. Atomically write `/etc/rancher/k3s/resolv.conf` containing **only** `nameserver <address>` lines and `/etc/rancher/k3s/config.yaml.d/30-alga-dns.yaml` containing `resolv-conf: /etc/rancher/k3s/resolv.conf`. Compare bytes first: identical contents cause no restart; re-runs refresh changed upstreams. Preserve unrelated k3s configuration and local-storage ownership.
4. For initial boot, finish both writes before `ensure_k3s_started`. For a running cluster, persist a pending activation record before restart, restart k3s once, wait for API readiness, and recreate affected existing pods. Restart CoreDNS first, then provisioner and Flux deployments, appliance application controllers, and control plane last. Include StatefulSets/DaemonSets where their existing pods inherit the old resolver configuration; handle existing unmanaged pods/jobs explicitly rather than claiming they were repaired. Do not delete PVCs or indiscriminately replay completed bootstrap jobs. New pods retain Kubernetes service search suffixes, but never the customer suffix.
5. Record the applied resolver fingerprint only after activation and rollout verification. A crash between file write and rollout must resume pending work, not mistake equal files for completed activation. Serialize concurrent bootstrap/setup/reconcile calls with a host-owned lock.

### Existing installs and custom DNS after first boot

A bootstrap-only patch is insufficient. `ee/appliance/host-service/host-agent.mjs:startControlPlaneUpgrade` invokes the host's baked bootstrap script. `ee/appliance/control-plane/Dockerfile` copies updated scripts into the image, not the host. The pod runs as UID 10001 and has no general host-root mount.

Use the existing host preparation precedent in `ee/appliance/scripts/install-storage.sh:prepare_storage_path` to add a narrowly scoped DNS reconciliation Job, proposed launcher `ee/appliance/scripts/reconcile-k3s-dns.sh`. Run in the existing privileged support namespace (`ee/appliance/control-plane/manifests/support-namespace.yaml`) under the existing setup Job permissions (`manifests/rbac.yaml`). Use the **currently running control-plane image digest**, cached locally with `IfNotPresent`, to avoid depending on a registry lookup that broken DNS prevents. Expose that image identity to the launcher via the current Pod/Deployment spec, not a moving channel tag.

The Job mounts host root and uses host PID/mount access only to stage the fixed DNS helper and launch a host-owned transient systemd service through host tools. Do not expose an arbitrary command endpoint. Pass only validated DNS configuration and fixed helper paths. The host service owns the lock, restart, readiness checks, rollout and durable completion/failure record, so k3s or control-plane replacement cannot kill the migration halfway through. Run the same helper on initial boot; avoid separate resolver-generation logic in Job YAML.

Wire startup and periodic reconciliation in `ee/appliance/host-service/server.mjs` to this launcher, independently of `reconcileBlockedSetup` and its attempt budget, with single-flight protection and content-based no-op behavior. Reuse the background repair lifecycle established by `ee/appliance/scripts/control-plane-entrypoint.sh`, but ensure only one DNS scheduler owns dispatch. This must work with **unchanged old host-agent and bootstrap files**. Reconcile again after setup inputs change and before `setup-engine.mjs:runSetupWorkflow` performs network preflight, so a newly selected custom resolver applies before redemption. Gate workflow launch on DNS activation completion; report an actionable DNS blocker on failure rather than retrying installation against stale configuration.

The staged helper and k3s files persist across reboots; an old baked bootstrap must not remove them. Stage the helper for fresh ISO builds through `ee/appliance/scripts/stage-control-plane-bundle.sh` as well. Adjust bootstrap usage text to reflect DNS reconciliation in control-plane-only mode.

## 2. Preserve failures, bound retries, and show the cause

### State lifecycle and retry accounting

Touch `ee/appliance/host-service/server.mjs:readRetryState`, `writeRetryState`, `clearRetryState`, `reconcileBlockedSetup`, `computeAutoRetrySummary`, and `queueSetupWorkflow`.

- Define a setup-run identity shared by install and retry state. Persist `attempts` (automatic launches only; initial/manual launch excluded), `maxAttempts`, timestamps/backoff, last failure, and a bounded failure history (latest 20 occurrences, deduplicated per attempt). Include step, phase, message, details, retry-safe flag and network diagnostics. Use atomic secure JSON writes; a failed/corrupt accounting write must stop automatic launch and surface an error, not silently reset the budget.
- Check running/queued work before blocked-state logic. Running, missing/transient state, healthy generic probes, and intermediate phase completion must never reset attempts/history. Preserve accounting across process restarts. Persist the increment and failure snapshot **before** launching each automatic child. A rejected network probe schedules another check without consuming a launch or dropping history. Enforce the existing default maximum of 10 automatic launches and backoff settings.
- Prevent duplicate launches across reconcile ticks and server restarts with durable workflow ownership/liveness checks. Count a spawn failure as an attempted automatic launch and retain it as a failure. Keep `retrySafe: false` and operator-correctable install codes non-retrying.
- Reset the active budget only for an explicit new manual setup submission or verified terminal success of the whole setup workflow; mark prior history resolved rather than deleting evidence. Update both setup submission paths in the server (the current `setup-queued` writes and `clearRetryState` call), not only automatic retries.

Touch `ee/appliance/host-service/setup-engine.mjs:writeInstallState`, `writeWorkflowInstallState`, `runSetupWorkflow`, and the CLI exception handler. Carry the unresolved last `failure` through **all** queued, running, and intermediate success writes; this includes direct `writeInstallState` callers such as preflight. Merge only the deliberately retained failure/run fields, not arbitrary old state. Replace failure on a new failure and clear it explicitly on whole-workflow success; do not treat every `*-complete` phase as terminal. The current final phase is `applyReleaseSelectionConfiguration` → `release-config-complete`; make terminal acknowledgment explicit in `runSetupWorkflow`. Preserve application-update state semantics.

### Engine log and network detail

`server.mjs:queueSetupWorkflow` should append both stdout and stderr to `<state-dir>/setup-engine.log` (0600), retaining detached execution and closing the parent's descriptors. Log attempt start/end and spawn/exit errors with timestamps. If the log cannot be opened, expose that error instead of reverting to `stdio: 'ignore'`. Add structured engine failure output for normal blocked returns, not only uncaught exceptions. Bound log growth with rotation between launches; never print setup inputs, claim codes, passwords, license tokens or request bodies.

Preserve nested error causes in `install-code.mjs:redeemInstallCode` and `setup-engine.mjs:applyRuntimeValuesAndReleaseSelection`. Network failures must record the target hostname, configured DNS servers, addresses returned/selected, and TLS/socket error code. Capture addresses from the transport lookup and socket where possible; a later diagnostic query must be labeled as such, not presented as the failed connection's destination. DNS failure should explicitly say no address was resolved. While licensing still uses fetch before Fix 3, compare bounded OS lookup and explicit DNS lookup diagnostics to reveal search-domain divergence.

### Overview

Update `ee/appliance/host-service/status-engine.mjs:buildStatusSnapshot` and `blockerFromFailure`, both server status collection call sites, and `ee/appliance/status-ui/app/page.tsx:StatusPage`, `blockers`, and status/blocker types.

Keep unresolved failure step/details and `attempts/maxAttempts` visible during running and backoff, as well as when exhausted or automatic retry is disabled. Distinguish “last attempt failed; retry running,” “waiting for network/backoff,” and “automatic retries exhausted.” A healthy GHCR probe must not clear a licensing failure: replace the current broad `recordedIsNetworkClass` suppression with operation-specific recovery, with workflow success authoritative for redemption. Include network destination diagnostics and the engine log location. The overview must not say “No action-required blockers detected” while an unresolved installation failure exists. Update fallback HTML failure rendering in `server.mjs` too. Escape all displayed diagnostics.

## 3. One resolver-aware transport for licensing and registry

Extract `setup-engine.mjs:resolveAddressesWithServers`, `resolverLookup`, and `httpsRequest` into a small shared host-service transport module. Preserve existing exports/test seams where used. Retain explicit A/AAAA lookups (make queries absolute with a trailing dot), Node `all`/`family` callback behavior, timeouts, OCI redirects, and cross-host Authorization removal. Keep the original URL hostname for TLS SNI and certificate verification; do not replace it with the resolved IP or disable TLS checks.

Extend the shared request function to send POST bodies (currently `req.end()` sends none). Wire `setup-engine.mjs:applyRuntimeValuesAndReleaseSelection` to pass `resolverServersForInputs(...)` into `install-code.mjs:redeemInstallCode`; its production path must use the shared transport, retaining injectable testing support. Preserve `/register` payload, friendly HTTP errors, response mapping and `correctable` behavior. Do not forward claim-code POST bodies across arbitrary redirects; reject redirects for redemption. Reject unsupported service URL protocols clearly. Preserve error causes and lookup diagnostics from Fix 2.

## Acceptance and test execution

Use Node's existing appliance tests plus real disposable Ubuntu/k3s validation; source-text assertions alone cannot demonstrate resolver or retry behavior.

| Test | Execution and required result |
| --- | --- |
| Resolver generator and bootstrap | Extend `host-service/tests/bootstrap-control-plane-script.test.mjs` with executed helper tests in temporary host roots: systemd upstream with wildcard search/options, IPv4/IPv6, custom mode, absent upstream fallback, empty/stub/invalid rejection, changed upstream, no-op re-run and dry-run. Assert exact two output files, ordering before first k3s start, no destructive fallback and restart only on change/pending activation. |
| Retry lifecycle | Add a server/retry behavior suite with injectable clock, probe and child launcher; follow blocked → queued → every running/intermediate completion → blocked beyond the configured cap, including a server restart. Assert monotonically bounded launches, continuously readable failure, deduplicated history, no duplicate child, accounting-write/spawn failures, non-retry-safe rejection, explicit manual reset and whole-workflow resolution. |
| Logs and overview | Extend `tests/setup-engine.workflow.test.mjs`, `tests/status-engine.test.mjs` and UI coverage. A fake child emits both streams and fails; both reach the log. While retrying/exhausted, healthy GHCR plus failed redemption still shows step, details, count and addresses in API/overview/fallback HTML. Verify redaction and no healthy empty state. |
| Shared transport | Extend `tests/install-code.test.mjs`, `tests/setup-engine.preflight.test.mjs` and transport tests with local DNS/TLS fixtures. Registry and redemption use identical explicit servers and absolute queries; test actual POST body, SNI/certificate verification, A/AAAA, timeout/TLS cause, friendly errors, and OCI redirect credential stripping. Use a local CA, never disabled TLS verification. |
| Fresh wildcard install | In a disposable VM, configure dnsmasq `address=/wildcard.test/<test-edge-IP>` and host `search wildcard.test`; confirm pre-fix lookup divergence. Install with test licensing credentials. Assert redemption, ready OCIRepository, app readiness/login, and inspect resolv.conf in CoreDNS, control plane, Flux, provisioner and app pods: Kubernetes suffixes allowed, `wildcard.test` absent. Keep wildcard active throughout. |
| Custom DNS | Select explicit test upstreams after UI starts. Confirm host k3s resolver file, pod search isolation and actual forwarding through CoreDNS to those servers using DNS query logs. ClusterFirst pods normally name the cluster DNS IP; do not falsely require upstream IPs directly in every pod. Change servers and reconcile again. |
| Forced redemption failure | Use a test hostname with wrong TLS destination or an unreachable license URL while registry probes stay healthy. Poll install state throughout several retries; step/details never disappear, count stops at cap, both log streams persist, overview names `redeem-install-code` and destination/error. Repair endpoint, explicitly retry, and verify resolution/history semantics. |
| Upgrade without reinstall | Start an old appliance with contaminated pods and unchanged baked host scripts/agent. Upgrade only control-plane image. Next reconcile installs both DNS files and completes host-owned activation even when the control plane restarts. Verify affected existing pods recreated, no PVC loss, no repeated restart on no-op, recovery after interrupted activation, upstream refresh, and persistence after host reboot. |

Run focused suites first, then `node --test ee/appliance/host-service/tests/*.test.mjs` and the status UI production build (`npm --prefix ee/appliance/status-ui run build`). Validate shell syntax for changed scripts. Record VM acceptance results separately in the implementation/validation step; no customer access or production claim consumption is required by this plan.

## Risks, boundaries, and open questions

- Restarting k3s and existing workloads causes a short interruption. Serialize activation, use readiness deadlines, and keep a durable failure/pending record visible if restart or rollout fails. Validate actual pod resolver files rather than assuming service restart repairs them.
- Existing hosts require host-owned execution supplied from the new image; updating `host-agent.mjs` alone cannot fulfill image-only upgrade acceptance. Verify host `systemd-run`/namespace tooling and cached-image operation on the supported ISO in the upgrade test. This is a release gate, not optional follow-up work.
- Automatic mode intentionally removes DNS search expansion while preserving upstreams. Environments requiring short external names must use FQDNs. Explicit custom resolvers must be reachable from CoreDNS/pod networking.
- Installation codes are single-use. Current engine comments note replay after successful redemption may need a reissued code. Preserve non-retry-safe consumed-code handling; do not expand this work into licensing transaction/idempotency redesign.
- Out of scope: cleartext `initialTenant.adminPassword` retention in `setup-inputs.json`; app-channel update overwriting never-installed setup state; customer DNS administration; fleet-wide historical remediation; manifest-only `dnsConfig.ndots` workarounds; unrelated storage/billing changes.
- No product clarification blocks implementation. The upgrade VM must settle host-tool availability and safe rollout sequencing before release; failures there require completing the migration mechanism, not weakening acceptance.
