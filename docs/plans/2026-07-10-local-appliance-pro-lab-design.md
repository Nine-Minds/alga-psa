# Local appliance Pro lab

## Purpose

The `alga-appliance-pro-lab` libvirt domain provides repeatable checkpoints across the appliance installation path. Operators can restore a known state to troubleshoot installation, licensing, deployment, and login behavior without reinstalling Ubuntu each time.

The existing `ubuntu24.04` domain and its disk are not part of this lab.

## Virtual machine

- Domain: `alga-appliance-pro-lab`
- Disk: a dedicated 60 GiB qcow2 volume in the libvirt `default` pool
- Compute: 6 vCPUs and 16 GiB RAM
- Installer: `ee/appliance/ubuntu-iso/output/alga-appliance-ubuntu-1.0-doccap-noninteractive.iso`
- Network: libvirt `default` network with the assigned MAC address and DHCP address recorded in every relevant snapshot description
- Edition: Pro, registered with a newly minted test install code

The VM uses internal qcow2 snapshots. Do not replace, convert, or copy over its qcow2 file while retaining the libvirt snapshot metadata. Doing so removes the embedded snapshot table and leaves unusable snapshot definitions in libvirt.

## Credentials

The lab uses the standard local appliance test credentials:

- Ubuntu user: `alga`
- Ubuntu password: `AlgaSmoke2026!`
- Alga admin: `bob@nineminds.com`
- Alga admin password: `AlgaAdmin!23`

The management password, setup token state, install code, tenant identity, and other checkpoint-specific details are recorded in the applicable snapshot descriptions and the generated snapshot inventory.

## Checkpoints

All checkpoints are taken with the VM shut down at a safe boundary. They contain disk state but not RAM state.

1. `00-empty-disk-iso-attached`: Empty appliance disk with the installer attached.
2. `01-os-installed-setup-ready`: Ubuntu and the appliance control plane are installed. Appliance setup has not been configured.
3. `02-management-auth-configured`: Management authentication is configured. Pro installation has not been submitted.
4. `03-pro-install-submitted`: The Pro setup request and install-code redemption have been accepted.
5. `04-platform-and-core-ready`: Platform and core readiness gates have passed. Remaining background work may still be running.
6. `05-fully-installed-login-verified`: Installation is complete, readiness is healthy, and MSP credentials have been verified through a real login.

Each snapshot description records the state represented by the checkpoint, expected behavior after boot, credentials relevant at that point, install-code status, network identity, and the next operator action.

## Validation

After creating all checkpoints, restore and boot each one in sequence. Confirm that its observed state matches its description. Finish by restoring `05-fully-installed-login-verified` and verify:

- The control-plane authentication and status APIs respond.
- Platform, core, bootstrap, login, and background readiness are healthy.
- The application responds on port 3000.
- A credentials login produces an authenticated MSP session.

Export the persistent domain XML and a snapshot inventory so the configuration and checkpoint notes can be reviewed without opening virt-manager.
