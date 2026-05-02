# T002 VM Smoke: Ubuntu ISO Unattended Install And Reboot

## Purpose

Validate that the custom Ubuntu appliance ISO boots in a representative VM, completes unattended install, and reboots into installed Ubuntu Server 24.04.

## Environment

- VMware ESXi VM (or equivalent cloud custom ISO VM)
- New empty virtual disk
- Appliance ISO produced by `ee/appliance/ubuntu-iso/scripts/build-ubuntu-appliance-iso.sh`

## Steps

1. Create a fresh VM and attach the generated Ubuntu appliance ISO.
2. Boot VM and watch installer console.
3. Verify unattended autoinstall starts without interactive prompts.
4. Wait for install completion and automatic reboot.
5. After reboot, confirm VM boots from installed disk (not ISO installer shell).
6. Log in on console and run:

```bash
cat /etc/os-release
systemctl status alga-appliance.service --no-pager
systemctl status alga-appliance-console.service --no-pager
```

## Expected Results

- Installer completes without human input.
- VM reboots successfully into installed Ubuntu.
- `/etc/os-release` reports Ubuntu 24.04.
- `alga-appliance.service` is active/listening setup plane.
- `alga-appliance-console.service` ran and printed setup guidance.

## Evidence To Capture

- Hypervisor screenshots for installer start and post-reboot login.
- Console capture showing service status commands above.
- Generated ISO filename and checksum used for the run.
