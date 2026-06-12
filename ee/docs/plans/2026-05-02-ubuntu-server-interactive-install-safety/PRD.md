# PRD — Ubuntu Server Interactive Install Safety

- Slug: `ubuntu-server-interactive-install-safety`
- Date: `2026-05-02`
- Status: Draft

## Summary

Rework the appliance ISO install flow so end users get a normal Ubuntu Server/Subiquity disk confirmation before any wipe, while keeping the Alga appliance payload bundled on the ISO and applying it at install time. The ISO should also be branded so the boot media clearly says **AlgaPSA Install**.

## Problem

The current appliance flow is too easy to loop into reinstalling forever and too risky for real hardware:

- the installer can boot straight into destructive storage actions without a user-facing confirmation path
- UTM on Apple Silicon can get stuck in a state where the ISO cannot be cleanly ejected, causing the VM to reboot back into the installer
- the install media is not clearly branded as an Alga PSA artifact

We need a safer, user-facing install path that still works offline and keeps the appliance payload on the ISO.

## Goals

- Present a branded **AlgaPSA Install** boot entry / ISO label.
- Use Ubuntu Server/Subiquity for the install flow.
- Ensure the user sees network configuration and drive erase / storage confirmation before destructive install actions.
- Keep the appliance bundle on the ISO so the install works offline.
- Apply the appliance payload at the end of the Ubuntu install.
- Boot the installed disk first after a successful install, even if the ISO remains attached.
- Preserve existing appliance runtime behavior after the install completes.

## Non-goals

- Ubuntu Desktop / full GUI installer branding.
- Network-dependent first-boot bootstrap.
- Redesigning the appliance runtime, setup wizard, or status UI.
- Custom theming inside Subiquity beyond basic boot/ISO branding.
- Changing production appliance behavior outside the install path.

## Users and Primary Flows

### Primary users

- MSP / admin users installing the appliance on real hardware
- Developers validating the appliance in UTM or other local VM environments

### Primary flows

1. User boots the ISO and sees an **AlgaPSA Install** choice.
2. Ubuntu Server starts and prompts for storage / disk confirmation before erasing anything.
3. User approves the target disk.
4. Installer completes Ubuntu installation and applies the bundled Alga appliance payload from the ISO.
5. On the next boot, the machine boots the installed disk rather than re-entering the ISO installer.

## UX / UI Notes

- ISO / boot branding should show **AlgaPSA Install**.
- Keep the stock Ubuntu Server install feel; do not add a second custom installer UI unless necessary.
- The install media should remain clearly tied to Alga PSA even when used outside UTM.
- If the installer can present a concise summary screen, it should indicate that this media includes the Alga appliance payload.
- The web setup/status UI should use the packaged React/Next App Router UI, Alga-like card/badge styling, asynchronous data loading, and skeleton placeholders for loading regions.

## Functional Requirements

1. The ISO must boot into a branded **AlgaPSA Install** entry.
2. The ISO label should identify the media as an Alga PSA install artifact.
3. The Ubuntu Server install path must let users configure network and require user confirmation before destructive disk operations.
4. The appliance web setup/status experience must use the packaged React/Next UI when available, falling back to legacy HTML only when the bundle is missing.
5. Setup defaults, detected network data, and status diagnostics must load asynchronously with skeleton loading states.
6. The appliance bundle must remain packaged on the ISO and available offline.
7. The install process must copy the bundled appliance payload into the target OS.
8. The install process must enable the appliance services and required persistence paths on the target OS.
9. After a successful install, the machine must boot the installed disk first if the ISO remains attached.
10. The installed system must not fall back into the installer loop by default.
11. The current setup/status services and persistence behavior must remain unchanged after the install completes.
12. The build flow must continue to work for VM smoke testing and offline ISO generation.

## Data / API / Integration Notes

Relevant files / surfaces:

- `ee/appliance/ubuntu-iso/config/nocloud/user-data`
- `ee/appliance/ubuntu-iso/scripts/build-ubuntu-appliance-iso.sh`
- `ee/appliance/ubuntu-iso/tests/t001-build-smoke.test.mjs`
- `ee/appliance/ubuntu-iso/overlay/etc/systemd/system/alga-appliance.service`
- `ee/appliance/ubuntu-iso/overlay/etc/systemd/system/alga-appliance-console.service`
- `ee/appliance/ubuntu-iso/overlay/opt/alga-appliance/`
- `ee/appliance/host-service/`

Implementation should preserve the current offline bundle model:

- the ISO contains the appliance payload
- installer-time hooks copy that payload into the target system
- first boot logic prefers the installed disk over the ISO when a completed install marker is present

## Risks / Constraints

- Subiquity configuration must preserve the user-facing confirmation step while still allowing our install-time payload copy.
- UTM can keep the installer media attached across reboot; the disk-first boot guard must be robust enough to avoid reinstall loops.
- Branding changes must not interfere with bootability on either BIOS or UEFI paths.
- The ISO payload must remain small enough to build and boot reliably.

## Rollout / Migration

- No server-side migration is expected.
- The new ISO should replace the existing smoke / install artifact during validation.
- Existing appliance runtime state on already-installed systems should not require conversion.

## Acceptance Criteria

- Boot media is visibly branded as **AlgaPSA Install**.
- The installer lets users configure network and asks for disk confirmation before any wipe.
- The web setup/status UI is React/Next-based, Alga-styled, and shows skeletons while API data loads.
- The appliance bundle is still installed from the ISO without requiring internet access.
- A completed installation boots the installed disk, not the ISO installer.
- The appliance services start normally after the install completes.
- VM smoke testing no longer gets trapped in an endless reinstall loop.
