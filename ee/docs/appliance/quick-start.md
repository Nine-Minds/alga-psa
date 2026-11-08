# Quick Start Guide (Ubuntu Appliance)

This guide covers new installs on VMware ESXi, Proxmox VE, or cloud VMs using the Ubuntu appliance ISO.

## 1. Prepare VM

- Create a VM with a new disk and attach the Alga Ubuntu appliance ISO.
- Use networking that allows a workstation browser to reach VM port `8080`.
- Prefer DHCP reservation or static IP so the setup URL stays stable.
- Size it at 4 vCPUs and 16 GB RAM minimum; 6-8 vCPUs are recommended.

### VM hardware settings

Hypervisor defaults can make the appliance much slower without any
visible error. The status page warns when it detects the CPU or disk problems
below.

**CPU type.** The appliance needs the `aes`, `pclmulqdq`, and `avx2` CPU
features. Without them, TLS in Kubernetes, Postgres, and Node runs in software
and vectorised code falls back to scalar.

- Single host: set the CPU type to `host`.
- Proxmox: the default `x86-64-v2-AES` type and the built-in `x86-64-v3` type
  both lack `pclmulqdq`. If you need live migration, define a custom model in
  `/etc/pve/virtual-guest/cpu-models.conf` (shared across the cluster):

  ```
  cpu-model: alga-v3
      flags +aes;+pclmulqdq;+popcnt;+pni;+sse4.1;+sse4.2;+ssse3;+avx;+avx2;+bmi1;+bmi2;+f16c;+fma;+abm;+movbe;+xsave
      reported-model qemu64
  ```

  Apply it with `qm set <vmid> --cpu custom-alga-v3`. This model runs on Intel
  Haswell or newer and any AMD Zen, so the VM can migrate between vendors. If
  every host shares one vendor, a named model that matches the oldest host
  (for example `Cascadelake-Server` or `EPYC-Rome`) also works.
- A CPU type change takes effect only after a full stop and start of the VM. A
  reboot from inside the guest does not apply it.

**Disk.** The Kubernetes datastore and Postgres wait on every disk write, so
write latency sets the pace for the whole appliance.

- Use SSD or NVMe-backed storage. On Proxmox, prefer a raw disk on LVM-thin or
  ZFS over a qcow2 file on directory storage such as `local`.
- Enable SSD emulation and discard.
- Leave the cache mode at the default (`none`). Never use `unsafe`.

**Guest agent (Proxmox).** Enable the QEMU guest agent in the VM options and
install `qemu-guest-agent` in Ubuntu. Without it, Proxmox counts the guest's
page cache as used memory and the memory graph reads near-full when it is not.

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

The appliance does not update itself. When a newer release is published to your
channel (`stable` or `nightly`), the status page at `http://<node-ip>:8080`
shows an "Update available" banner; apply the update from Manage → Updates.

v1 scope is app-only updates. Ubuntu and k3s updates are manual/support-run.
See the operator's manual "Updates And The Upgrade Path" for the full picture.
