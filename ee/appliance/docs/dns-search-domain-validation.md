# DNS search domain and install failure validation

Validated on 2026-09-23 against branch commit `275375dd4a` on the disposable
`ubuntu24.04` appliance VM. The VM was restored to its pre-test snapshot after
the checks. The implementation plan is
[here](../../../docs/plans/2026-09-22-appliance-dns-search-domain-leak.md).

## Automated gate

`node scripts/run-appliance-tests.mjs` passed all 377 appliance tests and built
the status UI with TypeScript checking. `bash -n` passed for the DNS helper and
reconcile launcher. The focused reconcile launcher suite passed all eight tests.

## Cluster DNS on an existing install

The upgraded control-plane image contained util-linux `nsenter` 2.42.3. Its DNS
reconcile Job launched the host-owned activation service. The activation record
reached `active`; `/etc/rancher/k3s/resolv.conf` contained only `nameserver`
lines and the `30-alga-dns.yaml` drop-in selected that file. Flux's
`OCIRepository/alga-appliance` was Ready. The control-plane, Flux, local-path
provisioner, and app pods inspected after rollout had only Kubernetes service
search suffixes in `/etc/resolv.conf`. This was an image-only upgrade on an
existing VM.

## Wildcard search domain and custom DNS

On the VM, dnsmasq answered names under `wildcard.test` with the VM address.
The host's upstream resolver file contained `search wildcard.test`. With
`dnsMode: system`, k3s used the dnsmasq nameserver without copying that search
line into pods. A control-plane `dns.lookup("license.nineminds.com")` returned
the public address, and Flux continued to pull its OCI artifact.

The Manage app URL API then selected `dnsMode: custom` with dnsmasq as its sole
server while the host used a different upstream. The activation record matched
the custom configuration. dnsmasq's query log showed the control-plane pod's
external lookup arriving through CoreDNS, so the selected server was used for
pod forwarding.

## Redemption failure and bounded retries

The test temporarily set an invalid license hostname and a two-attempt cap. A
retry-safe blocker was injected to start the live retry path. The engine then
produced a real `redeem-install-code` failure with the target hostname, selected
DNS server, and failed lookup in `failure.details`. That failure remained in
`install-state.json` through running phases. `auto-retry-state.json` stopped at
two attempts with two history entries; `setup-engine.log` recorded both launches
and exits. The overview named the failed step and showed the exhausted count.
The production default cap remains ten; its accounting is covered by the
automated suite.

## Fresh setup under the wildcard

The installed app state was removed from the snapshotted VM. The VM's saved
install code had expired, so a new test code was issued. With the wildcard
still active on the host, the new code redeemed, setup reached terminal success,
Flux's OCIRepository became Ready, and the app pod started. The tenant bootstrap
Job completed, and a NextAuth login returned the new admin session with the
expected Essentials tier. Flux and app pod resolver files contained only
Kubernetes search suffixes.

Pulling the large app and worker images briefly caused kubelet disk pressure on
this VM and evicted a worker pod. Disk space recovered; a k3s restart cleared the
stale condition and the bootstrap Job completed. The overview still reported
background health degradation from the failed worker pods at the final capture,
so this run proves core setup and login, not a fully healthy background tier.
The OS was not reprovisioned from an ISO, so first boot on a new disk remains
unverified.

The captured state files, resolver output, dnsmasq log excerpts, status snapshots,
and overview screenshots are in
`/tmp/alga-appliance-dns-takeover-20260923/` on the workstation. They contain no
claim code or setup password. A test tenant was created in the licensing service
for the fresh run.
