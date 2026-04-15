# Alga PSA Appliance Docs

This section is the user-facing documentation set for operating the Alga PSA appliance.

It is written for technical IT administrators and MSP technicians who need to install, operate, support, and understand the appliance without digging through internal repo structure first.

## Documents

- `quick-start.md`
  - Fast path from release artifact to first login.
- `operators-manual.md`
  - Day-2 operation: status, workloads, logs, upgrades, resets, and support bundles.
- `technical-reference.md`
  - Appliance architecture, release model, storage, networking, Flux, and config layout.

## Reading Order

Use this order for most operators:

1. Read `quick-start.md` for first install.
2. Use `operators-manual.md` for normal operation and troubleshooting.
3. Use `technical-reference.md` when you need to understand how the appliance is put together.

## Related Deeper Reference

The docs in `ee/docs/premise/` remain the generic Talos appliance platform references. Use them when you need more detail on the underlying Talos and GitOps model.

- `../premise/README.md`
- `../premise/talos-release-model.md`
- `../premise/talos-host-configuration.md`
- `../premise/talos-gitops-bootstrap.md`
- `../premise/talos-alga-bootstrap-and-persistence.md`
- `../premise/talos-support-bundles.md`
- `../premise/talos-operations-and-troubleshooting.md`
