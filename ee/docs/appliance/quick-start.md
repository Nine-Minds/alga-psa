# Quick Start Guide (Ubuntu Appliance)

This guide covers new installs on VMware ESXi or cloud VMs using the Ubuntu appliance ISO.

## 1. Prepare VM

- Create a VM with a new disk and attach the Alga Ubuntu appliance ISO.
- Use networking that allows a workstation browser to reach VM port `8080`.
- Prefer DHCP reservation or static IP so the setup URL stays stable.

## 2. Boot ISO And Wait For First Reboot

- Ubuntu autoinstall runs unattended.
- VM reboots into installed Ubuntu Server 24.04 LTS.

## 3. Open Setup

After reboot, console shows:

- node IP
- setup URL: `http://<node-ip>:8080/setup`
- setup token
- console fallback command

Open setup URL from your workstation and include the setup token.

## 4. Complete Setup

Required values:

- release channel (`stable` default, `nightly` for testing/support-directed use)
- app URL/hostname
- DNS mode (`DHCP/system resolvers` default)
- optional support/testing repo URL/branch override

Important DNS behavior:

- default keeps system/DHCP resolvers
- custom public DNS (for example `8.8.8.8,8.8.4.4`) is deliberate opt-in
- do not override internal AD/split-horizon DNS unless intended

Setup runs preflight checks for DNS, GitHub channel access, GHCR reachability, and proxy/egress before k3s install.

## 5. Track Status

Use `http://<node-ip>:8080` for status and diagnostics during and after setup.

Readiness tiers include platform/core/bootstrap/login/background/fully-healthy.
Background service issues do not block login readiness.

## 6. App Updates

Use `http://<node-ip>:8080/updates?token=<status-token>` for app-channel updates (`stable` or `nightly`).

v1 scope is app-only updates. Ubuntu and k3s updates are manual/support-run.
