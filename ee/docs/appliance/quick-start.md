# Quick Start Guide

This guide takes you from appliance ISO to first Alga PSA login.

It assumes you are a technical IT administrator or MSP technician with:

- a supported VM host
- the appliance ISO for the release you want to install
- a workstation that can reach the appliance VM
- the appliance operator available from this repo or a packaged asset bundle

## 1. Prepare The VM

Create a new VM and attach the appliance ISO.

Recommended first-install settings:

- use a clean new disk
- use bridged networking if you want the appliance directly reachable on your LAN
- keep the appliance IP stable during bootstrap
  - use a DHCP reservation or
  - assign a static address

You will need:

- appliance release version
- appliance IP or DNS name
- hostname
- network mode: DHCP or static
- interface name
- static IP, gateway, and DNS values if not using DHCP

## 2. Boot The ISO

Start the VM and wait for the Talos maintenance screen.

Confirm from the VM console:

- the VM has an IP address
- the network is up
- the node is in Talos maintenance mode, not booting a previously installed disk

If the VM boots an existing Talos install, stop here and reset or recreate the disk before continuing.

## 3. Start The Operator

From your workstation, launch the appliance operator:

```bash
ee/appliance/appliance tui
```

The operator is the supported interface for:

- bootstrap
- upgrade
- reset
- status
- workload inspection
- support bundle export

## 4. Run Bootstrap

In the TUI:

1. Choose `Bootstrap`.
2. Select the appliance release.
3. Enter:
   - site ID
   - node IP
   - hostname
   - app URL
   - network mode
   - interface
   - DNS settings if needed
4. Confirm the action.

`siteId` is a stable operator label for this appliance on your workstation. Choose something clear, for example:

- `customer-a`
- `hq-primary`
- `appliance-lab-01`

The operator uses it for the local config directory:

```text
~/.alga-psa-appliance/<site-id>/
```

Bootstrap will:

- generate Talos machine config
- persist operator access files under `~/.alga-psa-appliance/<site-id>/`
- bootstrap the Talos node
- install storage prerequisites
- install Flux
- apply the appliance release
- wait for the initial Alga PSA rollout

## 5. Verify First Login

After bootstrap completes:

1. Open `Status` and confirm the appliance is healthy or converging normally.
2. Open `Workloads` and verify the `msp` workloads are starting successfully.
3. Capture the first-admin claim link printed by bootstrap:

```text
Appliance claim URL (one-time): https://<your-app-host>/auth/appliance-claim?token=...
```

If that output is lost, retrieve the token directly from Kubernetes:

```bash
kubectl --kubeconfig ~/.alga-psa-appliance/<site-id>/kubeconfig \
  -n msp get secret appliance-claim-token \
  -o jsonpath='{.data.token}' | base64 --decode; echo
```

Then open:

```text
https://<your-app-host>/auth/appliance-claim?token=<retrieved-token>
```

4. Open the app URL you configured, for example:

```text
http://<appliance-ip>:3000
```

You should reach the appliance claim flow first. After claim is complete, use normal MSP sign-in.

For day-2 tasks and deeper troubleshooting, continue with:

- [operators-manual.md](/Users/roberisaacs/alga-psa.worktrees/feature/on-prem-enterprise-helm-install/ee/docs/appliance/operators-manual.md)
- [technical-reference.md](/Users/roberisaacs/alga-psa.worktrees/feature/on-prem-enterprise-helm-install/ee/docs/appliance/technical-reference.md)
