# Alga PSA Appliance Docs

This section is the supported Ubuntu appliance documentation set.

Ubuntu Server 24.04 LTS is the supported appliance OS path for v1. Talos appliance artifacts remain legacy/internal and are not the default customer install path.

## Documents

- `quick-start.md`
  - ISO boot to first login via host setup/status service on port `8080`.
- `operators-manual.md`
  - Day-2 operation: status, diagnostics, support bundles, and app-channel updates.
- `technical-reference.md`
  - Architecture and deeper implementation details.

## Reading Order

1. Read `quick-start.md` for first install on VMware ESXi/cloud VM.
2. Use `operators-manual.md` for support and updates.
3. Use `technical-reference.md` for internals.

## Support Boundary

- Supported v1 update automation: Alga app-channel updates (`stable`/`nightly`) through host status UI.
- Not automated in v1: Ubuntu package updates and k3s version upgrades.
- v2 direction: managed maintenance windows for OS/k3s upgrades, with preflight, history, and remediation guidance.
