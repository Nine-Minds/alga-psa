# Appliance Install Guide (On-Premise ISO)

The appliance is the turnkey way to self-host AlgaPSA on your own hardware or VM. It ships as a single bootable ISO that installs the operating system, a self-contained Kubernetes runtime, and AlgaPSA with its database, cache, and background workers. You boot the image, answer a short setup wizard, and sign in. There are no containers to assemble and no manifests to write.

If you would rather build from source or manage the containers yourself, use the [Complete Setup Guide](setup_guide.md) for the Docker Compose path instead.

## What the appliance installs

| Component | What it does |
| --- | --- |
| AlgaPSA application | The web app your team signs in to, on port `3000`. |
| Setup and status console | A separate console on port `8080` for first-time setup and ongoing health. |
| In-cluster services | Postgres, Redis, Temporal, and the workflow and email workers, all managed for you. |
| Kubernetes runtime | A single-node control plane that pulls and reconciles the application during setup. |

You work in the application on port `3000`. You check its health on port `8080` when you need to.

## Editions and the install code

When you register, you receive an **install code** by email. The code binds the appliance to your tenant and applies the correct edition, so you do not pick an edition during setup.

- **Essentials** runs the free, open-source feature set and is community-supported. The application offers a 15-day Enterprise trial you can start at any time from inside the app.
- **Paid editions** add the integration layer, a support contract, and an SLA.

Install codes are single-use. Keep the registration email handy. You enter the code once, in the setup wizard.

## Requirements

| Requirement | Recommendation |
| --- | --- |
| Host | A 64-bit x86 machine or VM. The appliance image is Ubuntu Server 24.04. |
| CPU and memory | 4 vCPUs and 16 GB RAM is a practical starting point. The appliance runs a database, cache, workers, and the application together. |
| Disk | At least 60 GB. The installer uses the whole disk you select. |
| Network address | A reachable IPv4 address. If you use DHCP, reserve the lease so the address does not change after a reboot. |
| Outbound internet | HTTPS (port 443) to `license.nineminds.com` and `ghcr.io`. |
| Install code | The code from your AlgaPSA registration email. |

Outbound access matters most. During setup the appliance contacts `license.nineminds.com` to redeem the install code, then pulls its images from GitHub Container Registry (`ghcr.io`). If a firewall blocks either host, setup pauses at that step until you open the access.

## Install steps

### 1. Register and download

Register for the appliance at [nineminds.com/self-hosted](https://www.nineminds.com/self-hosted). You receive an install code and an ISO download link by email. For security, install codes are delivered only by email.

### 2. Prepare the machine and boot the ISO

Create a VM with a fresh disk, or use a bare-metal machine, and attach the ISO. Use networking that lets a workstation browser reach the machine on port `8080`. Power on and boot from the ISO. Ubuntu installs unattended, then the machine reboots into Ubuntu Server 24.04.

### 3. Read the setup banner

After the reboot, the console prints a setup banner with:

- the node IP address
- the setup URL, for example `http://<node-ip>:8080/setup`
- a one-time setup token
- a console fallback command

The setup console is usually reachable within a minute or two of first boot.

### 4. Complete the setup wizard

Open the setup URL from a workstation on the same network and enter the setup token. Then provide:

- your **install code** from the registration email
- a management password for the setup and status console
- your company name, which becomes the first tenant
- the administrator account (name, email, and password) you will sign in with

The wizard runs preflight checks for DNS, GitHub access, and registry reachability. It then deploys the platform unattended: it pulls the application images, runs database migrations, and creates your tenant and administrator. This usually takes several minutes, depending on your download speed.

### 5. Sign in and onboard

When the application is ready, open AlgaPSA on port `3000`, for example `http://<node-ip>:3000/`, and sign in with the administrator email and password from the wizard. Guided onboarding walks you through your team, your first client, a billable service, and ticketing.

A first install takes about 30 to 45 minutes, most of it unattended.

## After install

Use the status console on port `8080` for health and diagnostics. App-channel updates (`stable` or `nightly`) run from the status console at `http://<node-ip>:8080/updates`. In the current release, Ubuntu and Kubernetes updates are run manually.

Install codes are single-use. If you lose your code or need to reinstall, re-issue a fresh one for the same tenant from [nineminds.com/self-hosted](https://www.nineminds.com/self-hosted).

## Related documentation

- [Self-Hosting AlgaPSA: The On-Premise Appliance](https://www.nineminds.com/documentation/181-self-hosting-overview) — full walkthrough with screenshots
- [Installing the appliance OS](https://www.nineminds.com/documentation/182-installing-the-appliance-os) — the Ubuntu installer questions
- [Configure the appliance](https://www.nineminds.com/documentation/183-appliance-setup-wizard) — the setup wizard in detail
- [First sign-in and onboarding](https://www.nineminds.com/documentation/184-first-sign-in-and-onboarding) — team, client, billing, and ticketing
- [Appliance Quick Start](../../ee/docs/appliance/quick-start.md) — VMware ESXi and cloud VM notes
- [Appliance Operator's Manual](../../ee/docs/appliance/operators-manual.md) — day-2 operation and updates
