# Appliance Install (Talos Single-Node)

## 1. Verify prerequisites
- Read `ee/appliance/docs/PREREQUISITES.md`.
- Confirm VM meets CPU/RAM/disk requirements.
- Confirm node has outbound DNS and image registry egress.

## 2. Run deterministic bootstrap
```bash
ee/appliance/scripts/bootstrap-site.sh \
  --node-ip 192.168.64.4 \
  --cluster-name alga-appliance-dev \
  --talos-version v1.8.3 \
  --k8s-version 1.31.4 \
  --workdir /tmp/alga-appliance/bootstrap
```

## 3. Validate cluster access (isolated kubeconfig)
```bash
KUBECONFIG=/tmp/alga-appliance/bootstrap/kubeconfig kubectl get nodes -o wide
KUBECONFIG=/tmp/alga-appliance/bootstrap/kubeconfig kubectl get pods -n kube-system
```

## 4. Expected outputs
- Node should be `Ready`.
- Control-plane pods should be running.
- Script prints local config artifacts:
  - `talosconfig` path
  - `kubeconfig` path

## Notes
- Script never merges into `~/.kube/config`.
- Script never reads or writes `~/.talos/config`.
- On failure, diagnostics are written to:
  - `/tmp/alga-appliance/bootstrap/last-diagnostics.log`

