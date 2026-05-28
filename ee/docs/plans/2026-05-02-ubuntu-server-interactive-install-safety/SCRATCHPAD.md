# Scratchpad — Ubuntu Server Interactive Install Safety

## Context / Discoveries

- Current appliance ISO flow is built under `ee/appliance/ubuntu-iso/`.
- The build script stages `host-service`, `operator`, `scripts`, `manifests`, `flux`, `releases`, and `status-ui` into the ISO overlay.
- Current `user-data` is autoinstall-based and already uses `late-commands` to copy bundled appliance files into the target system.
- UTM smoke testing exposed a loop where the VM can reboot back into the installer if the ISO cannot be detached cleanly.
- UTM docs state that CD/DVD images are meant to be removable media, but the runtime can still get stuck in a state where eject is not available.
- GitHub discussion `utmapp/UTM#6130` reports a similar Apple Silicon / UTM version issue where ISO eject appears unavailable or the VM window closes without fully stopping the VM.

## Decisions

- Keep the Ubuntu Server installer as the install surface; do not switch to Ubuntu Desktop.
- Prioritize a user-facing disk confirmation before destructive storage actions.
- Keep the appliance bundle on the ISO so installation works offline.
- Use a branded boot / ISO label: **AlgaPSA Install**.
- Add a disk-first boot guard so a completed install does not re-enter the installer loop if the ISO remains attached.

## Key Files

- `ee/appliance/ubuntu-iso/config/nocloud/user-data`
- `ee/appliance/ubuntu-iso/scripts/build-ubuntu-appliance-iso.sh`
- `ee/appliance/ubuntu-iso/tests/t001-build-smoke.test.mjs`
- `ee/appliance/ubuntu-iso/overlay/etc/systemd/system/alga-appliance.service`
- `ee/appliance/ubuntu-iso/overlay/etc/systemd/system/alga-appliance-console.service`
- `ee/appliance/ubuntu-iso/overlay/opt/alga-appliance/`

## Validation Notes

- Existing VM bundles and ISO artifacts were moved to `/Volumes/Extreme SSD/alga-appliance-smoke/` to avoid exhausting the internal disk.
- The current smoke build path already supports configurable work/output dirs via `ALGA_APPLIANCE_ISO_WORK_DIR` and `ALGA_APPLIANCE_ISO_OUTPUT_DIR`.
- Boot branding should stay simple; user accepted only boot/ISO labeling, not a custom installer theme.
- Implemented Subiquity storage confirmation through `autoinstall.interactive-sections: [storage]`; the existing direct storage layout remains the preselected install target but destructive disk actions require user confirmation.
- The ISO remaster now writes `.disk/info` as `AlgaPSA Install`, uses ISO volume label `ALGAPSA_INSTALL`, and prepends a guarded GRUB `AlgaPSA Install` entry.
- The disk-first guard uses `/etc/alga-appliance/booted-from-disk`, created by `late-commands` in the installed target. If the ISO remains attached, GRUB searches for the marker and chains to the installed disk's `/boot/grub/grub.cfg`.
- `node --test ee/appliance/ubuntu-iso/tests/t001-build-smoke.test.mjs` passes and covers T001-T004 with a fake `xorriso` remaster: branding, ISO label, offline overlay, storage interactivity, payload copy, service enablement, and disk marker behavior.
- `node --test ee/appliance/host-service/tests/*.test.mjs ee/appliance/ubuntu-iso/tests/*.test.mjs` passes except for `t003-first-boot-smoke` under sandboxed localhost networking (`connect EPERM 127.0.0.1:18081`). The targeted first-boot smoke passes when rerun with localhost socket permissions: `node --test ee/appliance/host-service/tests/t003-first-boot-smoke.test.mjs`.
- `ee/appliance/host-service/tests/t003-first-boot-smoke.test.mjs` now covers the first-boot console banner, `/healthz`, static setup/status UI serving from `ALGA_APPLIANCE_STATUS_UI_DIR`, unauthorized setup protection, setup config JSON, and setup submission persistence. The test uses `ALGA_APPLIANCE_DISABLE_SETUP_QUEUE=1` so it verifies web setup behavior without starting the real bootstrap workflow.
- Real remaster build succeeded with the Ubuntu 24.04.4 base ISO: `ALGA_APPLIANCE_ISO_WORK_DIR="/Volumes/Extreme SSD/alga-appliance-smoke/work" ALGA_APPLIANCE_ISO_OUTPUT_DIR="/Volumes/Extreme SSD/alga-appliance-smoke/iso-output" bash ee/appliance/ubuntu-iso/scripts/build-ubuntu-appliance-iso.sh --base-iso "/Volumes/Extreme SSD/alga-appliance-smoke/ubuntu-24.04.4-live-server-amd64.iso" --release-version smoke-20260503-round8`.
- Real artifact: `/Volumes/Extreme SSD/alga-appliance-smoke/iso-output/alga-appliance-ubuntu-smoke-20260503-round8.iso`; `xorriso -pvd_info` reports volume id `ALGAPSA_INSTALL`, and the staged ISO root has `.disk/info` = `AlgaPSA Install`.
- The real round8 GRUB configs contain the `AlgaPSA Install` entry, the `/etc/alga-appliance/booted-from-disk` search guard, and `autoinstall ds=nocloud;s=/cdrom/nocloud/`.
- UTM CLI check found `Ubuntu-Appliance-Persistence-Smoke-Round7` running with UUID `5E97B267-A8D8-4671-A152-FD588A207F53`; its config has only the qcow2 disk attached and no CD/DVD drive, which supports that it is not currently booting the installer ISO. Host service ports `8080` and `3000` were not reachable at `192.168.64.17`, so the full T005 readiness smoke remains unverified.
- T005 live VM evidence was completed on `Ubuntu-Appliance-Interactive-Smoke-Round10` (UUID `8AAE785E-F1C1-408A-9141-5CEA3DB48AAC`) after manual completion of the Subiquity install flow. Earlier screenshot evidence showed the interactive guided storage confirmation screen with the 80G QEMU disk selected and a user-facing `[ Done ]` action before destructive installation.
- Round10 config path: `/Volumes/Extreme SSD/alga-appliance-smoke/vms/Ubuntu-Appliance-Interactive-Smoke-Round10.utm/config.plist`. `plutil -p` shows only `Drive.0` as `ImageType = Disk` with qcow2 `450a1794-6063-448e-8b38-94c1ab4bdb65.qcow2`; no CD/DVD drive remains attached.
- `ps -ax -o pid,command` confirms the running Round10 QEMU process uses only `-device ide-hd` / `media=disk` for the qcow2 at `/Volumes/Extreme SSD/alga-appliance-smoke/vms/Ubuntu-Appliance-Interactive-Smoke-Round10.utm/Data/450a1794-6063-448e-8b38-94c1ab4bdb65.qcow2`, with no ISO/CD-ROM drive argument.
- ARP maps Round10 MAC `62:B8:F6:E9:2E:FF` to `192.168.64.20`; `nc -vz -w 3 192.168.64.20 22` and `nc -vz -w 3 192.168.64.20 8080` both succeed.
- Round10 console banner reports `Alga Appliance setup is ready`, node IP `192.168.64.20`, setup URL on port `8080`, local admin user `alga-admin`, and the temporary password/change-required flow.
- `curl -i http://192.168.64.20:8080/` returns HTTP 200 and the `Alga Appliance Setup` page.
- `curl http://192.168.64.20:8080/api/status?token=<current-console-token>` returns status JSON whose diagnostics show `alga-appliance.service` loaded/enabled/active running, `alga-appliance-console.service` loaded/enabled/active exited successfully, and the host service listening on `:8080`. The API reports setup phase because web setup/bootstrap has not been run yet; this still satisfies the install PRD acceptance criterion that the appliance services start normally after installation.

## Open Questions

- None for this install-safety PRD. Post-install web setup/bootstrap readiness is a separate flow from the ISO install safety acceptance criteria.

## 2026-05-03 Implementation Notes

- Added packaged React/Next setup route under `ee/appliance/status-ui/app/setup/page.tsx`.
- Reworked status UI styling to use Alga-like cards, badges, branded hero, and skeleton loading states.
- Added host-service JSON setup endpoints:
  - `GET /api/setup/config?token=...`
  - `POST /api/setup?token=...`
- Host-service now serves the built status UI from `/opt/alga-appliance/status-ui/dist` when available and falls back to legacy HTML otherwise.
- ISO staging now builds and copies the status UI bundle; it fails fast if dependencies or `dist` are missing unless explicitly skipped.
- Ubuntu autoinstall interactive sections now include both `network` and `storage`.
- Validation included host-service/API static smoke, Next build, and appliance test subset.

## 2026-05-03 Round9 Storage RBAC Finding

- Round9 local-path-provisioner failed with: `configmaps "local-path-config" is forbidden: User "system:serviceaccount:local-path-storage:local-path-provisioner-service-account" cannot get resource "configmaps"`.
- Root cause is likely RBAC collision/insufficient namespaced RBAC around k3s' built-in local-path objects using generic `local-path-provisioner-*` names.
- Updated `ee/appliance/manifests/local-path-storage.yaml` to use Alga-specific Role/ClusterRole/Binding names and added explicit namespaced configmap read access.
- Added test coverage to ensure the manifest avoids the generic ClusterRoleBinding name and grants configmap get/list/watch.
