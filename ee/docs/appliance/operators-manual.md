# Operator's Manual

This manual covers normal day-2 appliance operation.

Use it after the appliance is already installed.

## Start The Operator

Launch the operator with:

```bash
ee/appliance/appliance tui
```

If you have multiple appliance site configs on the same workstation, select the correct site when prompted.

## Main Areas

The operator is organized into:

- `Operations`
  - `Bootstrap`
  - `Upgrade`
  - `Status`
  - `Workloads`
- `System`
  - `Support Bundle`
  - `Reset`

## Status

Use `Status` when you need a high-level view of appliance health.

The status dashboard summarizes:

- Talos host reachability and health
- Kubernetes availability
- Flux source, kustomization, and Helm state
- PSA component health
- selected appliance release
- configured app URL
- appliance config paths

Use `Status` first whenever an operator reports “the appliance is down” or “an upgrade didn’t finish.”

## Workloads

Use `Workloads` to inspect the appliance pods in the `msp` namespace.

The workload table shows:

- pod name
- namespace
- current status
- ready containers
- restart count
- age

The view refreshes automatically so rollout or recovery state remains current.

### Workload Controls

- `Up` / `Down`
  - move between pods
- `Enter`
  - open logs for the selected pod
- `r`
  - refresh immediately
- `Esc`
  - return to the previous view

## Pod Logs

Press `Enter` from the workload view to open pod logs.

The log viewer is designed for appliance support work:

- it opens in a full-screen-focused log mode
- it follows live output while you remain at the bottom
- if you scroll upward, live-follow pauses
- older log chunks can be loaded without keeping unbounded history in memory
- `Esc` returns to the workload list

Use pod logs for:

- startup failures
- crash loops
- image pull issues
- bootstrap/migration errors
- runtime health problems

## Upgrade

Use `Upgrade` to move the appliance to a published appliance release.

The operator upgrade flow:

1. shows the current installed release
2. lets you choose the target appliance release
3. applies the new release selection
4. waits for Flux/Helm reconciliation

Important upgrade behavior:

- upgrades do not auto-rollback
- if an upgrade fails, the correct next step is support investigation, not repeated blind retries

Recommended upgrade sequence:

1. Check `Status`.
2. Confirm the appliance is currently healthy enough to upgrade.
3. Export a support bundle if you want a pre-upgrade checkpoint.
4. Run the upgrade.
5. Watch `Status` and `Workloads` until the appliance stabilizes.

## Bootstrap Troubleshooting

If first install does not complete cleanly:

1. Open `Status`.
2. Open `Workloads`.
3. Inspect logs for the failing pod.
4. Export a support bundle before making large manual changes.

Use this flow for:

- Talos/bootstrap failures
- stuck Flux or Helm reconciliation
- failed bootstrap jobs
- unhealthy `alga-core`, `db`, `redis`, or `pgbouncer` startup

## Initial Admin Claim Retrieval

Fresh appliance installs require a one-time claim token for the first MSP admin.

Bootstrap prints a claim URL once:

```text
Appliance claim URL (one-time): https://<app-host>/auth/appliance-claim?token=...
```

If that output is lost, retrieve the token from Kubernetes:

```bash
kubectl --kubeconfig ~/.alga-psa-appliance/<site-id>/kubeconfig \
  -n msp get secret appliance-claim-token \
  -o jsonpath='{.data.token}' | base64 --decode; echo
```

Then claim the appliance:

```text
https://<app-host>/auth/appliance-claim?token=<retrieved-token>
```

If the appliance is already claimed, the claim route will stop accepting new first-admin setup and normal MSP sign-in is the supported entry path.

## Reset

Use `Reset` only when you intend to wipe appliance runtime state.

Reset is destructive. It is intended for:

- disposable test appliances
- intentional reinstall
- support-directed recovery steps

The reset flow clearly states what will be wiped before it runs.

Do not use reset as a substitute for normal troubleshooting unless you are intentionally discarding the current appliance state.

## Support Bundle

Use `Support Bundle` whenever:

- an install fails
- an upgrade fails
- workloads are unhealthy and the cause is not obvious
- support asks for appliance diagnostics

The support bundle is the preferred first support artifact.

Generate it before making large manual changes whenever possible.

## Standard Troubleshooting Order

For most incidents, use this order:

1. `Status`
   - identify the failing layer
2. `Workloads`
   - identify the failing pod
3. pod logs
   - inspect the actual runtime failure
4. `Support Bundle`
   - capture diagnostics for escalation

## Common Situations

### Appliance reachable, app unavailable

Check:

- `Status`
- `Workloads`
- `alga-core` logs

### Upgrade stuck or failed

Check:

- Flux status in `Status`
- `alga-core` and dependent workload states
- pod logs for the failing component

Then export a support bundle.

### Repeated pod restarts

Open `Workloads`, select the pod, and inspect logs before restarting anything manually.

### IP or URL confusion

Use the header and status view to confirm:

- selected site
- current node IP
- selected release
- configured app URL

## When To Use Lower-Level Tools

Most operators should stay inside the operator UI.

Use raw `kubectl` or `talosctl` only when:

- directed by support or engineering
- performing advanced diagnosis not yet surfaced in the operator
- validating cluster behavior outside the supported operator workflow

## Related Reading

- `quick-start.md`
- `technical-reference.md`
- `../premise/talos-support-bundles.md`
- `../premise/talos-operations-and-troubleshooting.md`
