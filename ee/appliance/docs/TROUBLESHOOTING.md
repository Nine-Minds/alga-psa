# Appliance Bootstrap Troubleshooting

## Diagnostic artifact
- On script failure, inspect:
  - `/tmp/alga-appliance/bootstrap/last-diagnostics.log`

## Common failures and fixes

## `EPHEMERAL volume is not ready` / disk match errors
- Symptom:
  - `EPHEMERAL` phase is `failed`.
  - Error mentions `no disks matched for volume`.
- Fix:
  - Increase VM disk size.
  - Re-run bootstrap.

## `time is not in sync yet`
- Symptom:
  - `etcd`/`kubelet` blocked waiting for time sync.
- Script behavior:
  - Waits for time sync up to configured timeout.
  - Can auto-apply `machine.time.bootTimeout=2m0s` (default enabled).
- Fix:
  - Ensure site NTP is reachable.
  - Re-run with higher `--time-sync-timeout-sec` if needed.

## Kubernetes API not reachable on `6443`
- Symptom:
  - `kubectl` gets connection refused.
- Quick checks:
```bash
nc -vz <node-ip> 6443
talosctl --talosconfig /tmp/alga-appliance/bootstrap/talosconfig --nodes <node-ip> --endpoints <node-ip> service
```
- Fix:
  - Confirm control-plane pod pulls succeed (DNS/egress).
  - Confirm node has outbound access to required image registries.

## DNS-related control-plane pull failures
- Symptom:
  - etcd/control-plane services fail with lookup/registry errors.
- Fix:
  - Verify node DNS upstreams and outbound DNS traffic.
  - Validate site DNS resolver behavior under load.
  - Re-run bootstrap after DNS path is corrected.

## Talos API not reachable on `50000`
- Symptom:
  - Talos commands fail with connection refused/timeout.
- Fix:
  - Wait for reboot completion.
  - Confirm L3/L4 path to node IP.
  - Confirm endpoint IP is correct (`--endpoint` if different from node IP).

