# Talos Support Bundles

## Purpose

The first support posture for the Talos appliance is an exportable support bundle, not a persistent support tunnel.

That is a deliberate product boundary:

- the appliance must remain diagnosable in connected but tightly controlled environments
- support should not depend on live shell access
- the support surface should stay smaller than a remote-access platform

## Support Model

The appliance should assume:

1. customer environments are usually connected
2. support may ask the customer to run one bundle collection command
3. the resulting archive becomes the primary diagnostic artifact

This keeps support viable in environments where outbound tunnels are disallowed or heavily reviewed.

## Minimum Bundle Contents

A useful appliance bundle should include:

- cluster version and node inventory
- node conditions and scheduling state
- storage classes, PVs, PVCs, and recent events
- Flux source, `Kustomization`, and `HelmRelease` status
- workload inventory for `flux-system`, `alga-system`, and `msp`
- bootstrap job status and logs
- core application, database, and worker logs
- Talos node health and service state when a Talos context is available

The bundle is intended to answer the layered support question:

- is the failure at the Talos layer
- the Kubernetes/storage layer
- the GitOps layer
- or the application bootstrap/runtime layer

## Secret Handling

The bundle should not export live secret payloads.

Safe defaults are:

- include secret names only
- include references to credentials used by workloads
- exclude raw `data` values from Kubernetes `Secret` objects
- avoid embedding raw Talos machine config when it contains cluster credentials

## Operator Contract

Bundle collection must be predictable and low-friction.

The operator-facing contract should be:

1. one stable command
2. one generated archive
3. no need to manually gather pod logs, describe output, and Talos checks piecemeal

That is what makes the appliance supportable for customers who are not Talos experts.
