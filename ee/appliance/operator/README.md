# Appliance Operator CLI/TUI

Primary operator entrypoint:

```bash
ee/appliance/appliance tui
```

Non-interactive commands share the same operator core:

```bash
ee/appliance/appliance bootstrap --bootstrap-mode recover --release-version 0.0.1

ee/appliance/appliance upgrade --release-version 0.0.1

ee/appliance/appliance reset --force

ee/appliance/appliance status

ee/appliance/appliance support-bundle --output-dir ./bundles
```

Optional runtime override for standalone packaging:

```bash
ALGA_APPLIANCE_ASSET_ROOT=/opt/alga-appliance ee/appliance/appliance status
```

`ALGA_APPLIANCE_ASSET_ROOT` must point to a directory containing:

- `scripts/`
- `releases/`
- `flux/` (optional for status metadata but expected for full runtime parity)
