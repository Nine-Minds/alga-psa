# Talos Host Configuration

## Purpose

Talos should be treated as an immutable OS with one durable configuration boundary: machine configuration. If a change must survive reboot, it belongs there.

## Persistence Boundary

Temporary fixes are not enough for appliance behavior. The following must be expressed in machine configuration rather than one-off boot changes:

- network interface selection
- DHCP or static addressing
- DNS resolver selection
- host naming behavior
- single-node control-plane scheduling policy
- installer image selection

If a setting only exists in maintenance mode, boot media, or an ad hoc runtime patch and is not written into machine configuration, assume it can be lost on reboot or reinstall.

## Single-Node Appliance Scheduling

For a single-node appliance, workloads must be allowed to run on the control-plane node. The durable setting is:

```yaml
cluster:
  allowSchedulingOnControlPlanes: true
```

This is preferable to repeatedly removing the `node-role.kubernetes.io/control-plane:NoSchedule` taint by hand. Manual untainting is a recovery step, not the desired steady state.

## Network Configuration

Persistent networking should be expressed with Talos network config documents rather than relying on ephemeral interface choices.

Typical durable pieces are:

- `DHCPv4Config` or static address config for the intended NIC
- `ResolverConfig` for non-DHCP resolvers when appliance DNS must be fixed
- `HostnameConfig` when a stable Talos hostname policy is desired

Prefer selectors or deterministic device identification over brittle assumptions when possible. If the appliance depends on a specific interface, make that explicit in machine configuration.

## Installer Configuration

The machine config should reference the installer image that belongs to the selected release manifest. This keeps installs aligned with the ISO and schematic pair recorded in `release.json`.

Do not hand-edit installer image references without also re-establishing which release manifest the node now represents.

## Boot Media Rule

After Talos is installed to disk, subsequent boots must come from the installed disk, not the installer ISO.

If the machine is started from installer media again, Talos may halt with the equivalent of:

- Talos is already installed to disk
- the machine booted from another media
- reboot from disk

That is expected behavior. For appliance operations, the steady-state rule is:

1. boot from ISO for installation
2. install Talos to disk
3. remove or detach the ISO
4. boot from disk from then on

## Storage Assumption

The current single-node appliance profile assumes node-local persistent storage. In practice, that means the Kubernetes cluster must have a working `StorageClass` suitable for local PVCs before the application stack is expected to settle.

This is a cluster-level dependency, but on a Talos appliance it is effectively part of host bring-up because the application stack relies on it for:

- Postgres
- Redis
- local file storage
- optionally Temporal persistence

## Operational Guidance

When recovering a Talos appliance node, follow this order:

1. confirm the node is booting from disk rather than installer media
2. confirm the intended machine configuration is still applied
3. confirm network and resolver configuration are present in machine config
4. confirm single-node scheduling is enabled in config
5. only then move up to Kubernetes and Flux diagnosis

That order avoids spending time on higher-level symptoms caused by a lost host configuration.
