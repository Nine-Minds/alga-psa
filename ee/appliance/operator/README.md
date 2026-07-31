# Appliance Operator CLI/TUI

Primary operator entrypoint:

```bash
ee/appliance/appliance tui
```

Supported installs and upgrades are handled by the Ubuntu host setup/status service on port `8080`; the old script-driven bootstrap/upgrade flows have been removed. The operator remains useful for status, support bundles, repair helpers, and destructive reset in engineering/support contexts.

Non-interactive commands:

```bash
ee/appliance/appliance status

ee/appliance/appliance support-bundle --output-dir ./bundles

ee/appliance/appliance repair-release --release-name alga-core

ee/appliance/appliance reset --force
```

Optional runtime override for standalone packaging:

```bash
ALGA_APPLIANCE_ASSET_ROOT=/opt/alga-appliance ee/appliance/appliance status
```

`ALGA_APPLIANCE_ASSET_ROOT` must point to a directory containing:

- `scripts/`
- `flux/` (optional for status metadata but expected for full runtime parity)

Release channel publishing is not performed from this repository. Use the Argo workflow in `~/nm-kube-config/alga-psa/workflows/composite/alga-psa-build-migrate-deploy.yaml` with `publish-appliance-release=true`.
