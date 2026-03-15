# Talos Operations And Troubleshooting

## Purpose

Talos appliance failures are easier to recover when they are classified by layer. Most wasted time comes from debugging the wrong layer first.

Support should start by collecting a support bundle whenever possible. The layered checks below define what that bundle needs to capture and how to interpret it.

Use this order:

1. host and Talos reachability
2. Kubernetes node health and storage
3. Flux source and reconcile state
4. application bootstrap and runtime health

## Layer 1: Host And Talos

Check this layer first when:

- the node disappears from the network
- `kubectl` stops answering
- `talosctl` cannot reach the API

Common issues:

- the VM booted from installer media instead of disk
- network changes were never persisted into machine config
- the machine came back with the wrong NIC or resolver configuration

Typical interpretation:

- if ICMP and Talos API are both gone, start at the console
- if the console says Talos is installed but booted from another media, remove the ISO and boot from disk
- if networking only works after manual intervention, write the fix into machine configuration

## Layer 2: Kubernetes Node And Storage

Check this layer after Talos is healthy.

Focus on:

- node conditions
- taints
- schedulability
- storage classes
- PVC binding

Common issues:

- single-node control-plane taint prevents workload scheduling
- no persistent volume provisioner exists yet
- PVCs are pending, so Postgres and Redis never become healthy

Steady-state rule:

- single-node appliance clusters should persist `allowSchedulingOnControlPlanes: true`

That is better than recovering by removing the control-plane taint manually after every reboot.

## Layer 3: Flux Source And GitOps

Check this layer when:

- Flux controllers are running but releases do not progress
- the cluster still seems to be reconciling old repo content
- `HelmRelease` objects exist but do not pick up new changes

Common issues:

- `source-controller` cannot fetch the Git repository because cluster egress is broken
- the source artifact is stale even though the branch moved
- the wrong branch or path is configured for the appliance profile

Operational rule:

- verify `GitRepository` readiness and revision before assuming a chart fix is in-cluster

Do not keep debugging a Helm failure if Flux is still serving an older artifact.

## Layer 4: Application Bootstrap

Check this layer when:

- Postgres and Redis are healthy
- Flux is synced
- `alga-core` is still not usable

Focus on:

- bootstrap job existence and logs
- `db-credentials` availability
- whether the database was actually initialized
- whether the app pod is waiting on bootstrap or failing after it

Common issues:

- bootstrap job lifecycle is wrong for the install path
- database credentials rotated against an existing Postgres volume
- the runtime image does not contain the setup path the job expects
- the server started before bootstrap completed

## Resource Pressure In Local Hypervisors

Local Talos appliance testing under emulation or desktop virtualization can look like a network or image issue when it is mostly a CPU issue.

Practical signs:

- image pulls are extremely slow but eventually succeed
- `ContainerCreating` lasts a long time without OOM evidence
- node CPU is pegged while memory pressure remains false

Implications:

- do not assume `ErrImagePull` or long pulls are only registry problems in local lab runs
- check node CPU count and allocatable resources before over-diagnosing memory
- if the environment is a single emulated VM, increasing visible vCPUs may materially improve bring-up reliability

## Distinguishing Network From Runtime Failures

Not every slow start is a network problem.

Useful distinctions:

- if a small public image can be pulled, basic egress likely works
- if node conditions show no memory pressure, OOM is less likely to be the root cause
- if container runtime services are timing out or in unknown state, runtime instability may be the real blocker

The layered approach matters:

- fix host reachability first
- then cluster egress
- then runtime scheduling and pull behavior
- then app bootstrap

## Fresh-Install Validation Checklist

A generic fresh-install validation should confirm:

1. Talos API is reachable and the node is healthy.
2. The Kubernetes node is `Ready`.
3. Single-node scheduling is enabled.
4. A working storage class exists for PVC-backed workloads.
5. Flux source is synced to the intended repo revision.
6. `alga-core` bootstrap job runs.
7. Postgres databases and roles are created.
8. Migrations complete.
9. Seeds run once.
10. The server and dependent services become ready.

## Recovery Guidance

Prefer durable fixes over repeated hand-applied recovery steps.

Examples:

- persist NIC and DNS changes in machine config instead of retyping them after reboot
- persist control-plane scheduling in Talos config instead of repeatedly removing taints
- fix Helm bootstrap ordering in the chart instead of deleting failed jobs forever
- pin explicit image tags in the bootstrap path instead of relying on moving tags

That discipline is what turns a fragile lab sequence into an appliance model.
