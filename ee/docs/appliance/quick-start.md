# Quick Start Guide

This guide takes you from appliance release artifact to first Alga PSA login.

It assumes you are a technical IT administrator or MSP technician with:

- a supported VM host
- a downloaded appliance ISO
- a checkout of the appliance repo or packaged operator assets
- network access from your workstation to the appliance VM

## 1. Gather What You Need

Before you begin, have these ready:

- the appliance release version you want to install
- the Talos appliance ISO for that release
- a VM with the required CPU, memory, and disk allocated
- the DNS name or IP you want operators to use for the appliance
- network settings:
  - DHCP or static
  - IP address, subnet, gateway, and DNS if using static

If you are working from the repo, the operator entrypoint is:

```bash
ee/appliance/appliance tui
```

## 2. Create The VM

Create a new VM for the appliance and attach the ISO.

Recommended first-install posture:

- use a clean new disk
- use bridged networking if you want the VM directly reachable on the local network
- reserve the appliance IP in DHCP or assign a static address so the IP does not change during bootstrap

The appliance bootstrap flow depends on stable host reachability. Avoid DHCP setups where the VM changes IP between boot stages.

## 3. Boot The Appliance ISO

Start the VM and wait for Talos maintenance mode to appear.

Confirm from the VM console:

- the appliance has an IP address
- the network is reachable
- the node is in the Talos maintenance/installer state, not a previously installed disk boot

If the VM has already booted a previously installed Talos system, stop and reset the VM/disk before continuing.

## 4. Launch The Operator

From your workstation, start the operator:

```bash
ee/appliance/appliance tui
```

The operator is the preferred interface for:

- bootstrap
- upgrade
- reset
- status
- support bundle export

You do not need to remember `kubectl`, `talosctl`, or the appliance kubeconfig path for normal workflows.

## 5. Run Bootstrap

In the TUI:

1. Choose `Bootstrap`.
2. Select the target appliance release.
3. Enter:
   - node IP
   - hostname
   - public app URL
   - network mode
   - interface
   - DNS settings if needed
4. Confirm the action.

Bootstrap will:

- generate Talos machine config
- persist Talos and Kubernetes config under `~/nm-kube-config/alga-psa/talos/<site-id>/`
- bootstrap the Talos node
- install storage prerequisites
- install Flux
- apply the appliance release
- wait for initial Alga PSA bootstrap

## 6. Watch Progress

During bootstrap, watch for these milestones:

- Talos host becomes reachable
- Kubernetes node becomes `Ready`
- storage setup completes
- Flux source and reconcile complete
- `alga-core`, `db`, `redis`, and `pgbouncer` start successfully

If bootstrap fails, use the operator to collect a support bundle before making manual changes.

## 7. Verify The Install

After bootstrap completes:

1. Open the operator `Status` view.
2. Confirm:
   - Talos is healthy
   - Kubernetes is reachable
   - Flux is healthy or at least converging
   - core PSA workloads are healthy
3. Open `Workloads` and confirm the `msp` pods are running as expected.

If a workload is unhealthy, open its logs from the workload view before escalating.

## 8. Reach The Login Screen

Open the app URL you configured during bootstrap, for example:

```text
http://<appliance-ip>:3000
```

Use the actual DNS name or IP chosen for your deployment.

If the login screen does not load:

- verify the configured app URL
- verify the appliance IP did not change after bootstrap
- check the operator `Status` view
- inspect `alga-core` from `Workloads`

## 9. Save The Important Outputs

The operator/bootstrap flow persists the appliance access files under:

```text
~/nm-kube-config/alga-psa/talos/<site-id>/
```

That directory contains:

- `controlplane.yaml`
- `talosconfig`
- `kubeconfig`
- operator metadata such as `node-ip` and `app-url`

Do not rely on temporary directories for appliance access.

## 10. First Troubleshooting Path

If first install does not finish cleanly:

1. Open `Status`.
2. Open `Workloads`.
3. Inspect logs for the affected pod.
4. Export a support bundle.

For deeper platform explanation, continue with:

- `operators-manual.md`
- `technical-reference.md`
- `../premise/README.md`
