# Appliance Prerequisites (Talos Single-Node)

## Host VM Sizing (minimum)
- `vCPU`: 4
- `RAM`: 8 GiB
- `Disk`: 20 GiB recommended (hard minimum for bootstrap script checks: 4 GiB)

## Network Requirements
- Management connectivity from operator machine to node:
  - `TCP 50000` (Talos API)
  - `TCP 6443` (Kubernetes API)
- Node outbound DNS resolution and HTTPS egress to pull control-plane images.
- Working NTP/time sync upstreams for reliable bootstrap timing.

## Operator Workstation Requirements
- `talosctl` installed.
- `kubectl` installed.
- `jq` installed.
- `nc` (`netcat`) installed.

## Safety Constraints
- Use isolated config paths; do not merge into user-global kube/talos configs.
- Do not bake customer secrets into base image artifacts.

## Versioning Guidance
- Keep a pinned compatibility matrix for:
  - Talos OS version
  - talosctl version
  - Kubernetes version
  - Application release

