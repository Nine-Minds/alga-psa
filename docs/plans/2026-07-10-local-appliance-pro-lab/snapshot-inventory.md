# Appliance Pro lab snapshot inventory

## Current lab

- Domain: `alga-appliance-pro-lab`
- Current checkpoint: `05-fully-installed-login-verified`
- Running address: `192.168.122.173`
- MAC: `52:54:00:c1:36:68`
- Disk: `/var/lib/libvirt/images/alga-appliance-pro-lab.qcow2`
- Installer: `alga-appliance-ubuntu-1.0-doccap-noninteractive.iso`
- Installer SHA-256: `a01134c0bbebe4dbe08342d37089b0c1359fb186cfc49055d9e1b33fe0f70c1a`

## Credentials and registration

- Management password: `AlgaManage2026!`
- Ubuntu login at checkpoint 05: `alga` / `AlgaSmoke2026!`
- Alga admin at checkpoint 05: `bob@nineminds.com` / `AlgaAdmin!23`
- Tenant ID: `bd6dd1a8-e924-465f-b635-272a93b8eaef`
- Consumed install code: `6RSVUMNJ`
- Edition: Pro

The noninteractive ISO contained an unknown baked Ubuntu password. Checkpoints 01 through 04 predate password recovery. Reset the `alga` password through Ubuntu recovery mode if you need shell access from those checkpoints. Checkpoint 05 contains the known password above.

## Checkpoints

| Snapshot | Expected state after boot |
| --- | --- |
| `00-empty-disk-iso-attached` | Empty disk. Boots the appliance installer from the attached ISO. |
| `01-os-installed-setup-ready` | Control plane returns `needs-token` in setup mode. Setup token: `3603-0040-7971-6763-8487`. |
| `02-management-auth-configured` | Control plane returns `needs-password` in setup mode. No install code has been submitted. |
| `03-pro-install-submitted` | Pro registration is accepted and the release/Flux installation resumes after boot. Core, bootstrap, and login are not ready at the checkpoint boundary. |
| `04-platform-and-core-ready` | Platform, core, bootstrap, and login are ready. Background services are intentionally incomplete. This checkpoint preserves the interrupted bootstrap/migration state for troubleshooting. |
| `05-fully-installed-login-verified` | All readiness tiers are healthy. MSP login, Pro effective tier, Ubuntu SSH, and management login are verified. |

Every checkpoint was restored and booted successfully on 2026-07-10. Checkpoint 05 was restored last and left running.

## Restore commands

Restore and boot a checkpoint:

```bash
virsh snapshot-revert alga-appliance-pro-lab <snapshot-name> --running
```

Return to the ready appliance:

```bash
virsh snapshot-revert alga-appliance-pro-lab 05-fully-installed-login-verified --running
```

Inspect the tree and detailed notes:

```bash
virsh snapshot-list alga-appliance-pro-lab --tree
virsh snapshot-dumpxml alga-appliance-pro-lab <snapshot-name>
```

Do not replace, convert, or copy over `alga-appliance-pro-lab.qcow2`. The snapshots are embedded in that qcow2 file. Replacing it while retaining libvirt metadata makes the displayed snapshots unrestorable.

## Final checkpoint recovery history

Checkpoint 04 was deliberately taken while background installation was still converging. Continuing from it exposed a stale Knex migration lock left by the interrupted bootstrap. The final checkpoint includes these recovery actions:

1. Reset the Ubuntu `alga` password through recovery mode.
2. Forced one alga-core Helm reconciliation to recreate the bootstrap hook.
3. Released the stale Knex migration lock.
4. Allowed the idempotent bootstrap to complete migrations, tenant creation, licensing, and seeds.
5. Reset the lab admin password hash using alga-core's own encryption context.
6. Reconciled email-service after its workload became healthy.

The final validation showed all readiness tiers true, no blockers, and an authenticated MSP session with effective tier `pro`.
