# Kubernetes-Hosted Appliance Setup

This runbook covers the new Ubuntu/k3s appliance setup path for fresh installs.
It does not migrate existing host-based setup installs.

## Bootstrap Layers

1. Host substrate bootstrap starts k3s and waits for the Kubernetes API.
2. Host bootstrap imports the baked control-plane image archive from
   `/opt/alga-appliance/control-plane/images`.
3. Host bootstrap applies the local-path storage manifest from
   `/opt/alga-appliance/manifests/local-path-storage.yaml` without waiting on
   image pulls or smoke-test jobs.
4. Host bootstrap applies the control-plane manifests from
   `/opt/alga-appliance/control-plane/manifests`.
5. The setup/status UI and API run in the `alga-appliance-control-plane`
   namespace and listen on the existing setup port, `8080`.

The host should not run the setup/status API as the primary service on this
path. The host keeps only bootstrap, console, fallback tools, and a host-side
support-bundle command for diagnostics that require systemd/journal access.

## Primary Host Entrypoint

`alga-appliance-bootstrap.service` runs:

```bash
/usr/bin/env node /opt/alga-appliance/host-service/init-token.mjs
/opt/alga-appliance/scripts/bootstrap-control-plane.sh
```

The bootstrap script is intentionally limited to:

- k3s service readiness
- baked image archive import
- non-blocking local storage manifest apply
- control-plane manifest apply
- setup URL and fallback command reporting

## Setup URL And Token

The console banner prints the setup URL:

```text
http://<node-ip>:8080/setup?token=<setup-token>
```

The host creates the setup token before applying the control plane. Bootstrap
then creates/updates the `appliance-setup-token` Secret in
`alga-appliance-control-plane`, and the pod reads the token from
`/var/lib/alga-appliance-token/setup-token`. Setup/status API routes continue to
require that token until the appliance is ready.

Setup state is host-backed at `/var/lib/alga-appliance` via a Kubernetes
`hostPath` mount. This avoids needing dynamic PVC provisioning before the setup
UI can start while still surviving pod restarts on the single-node appliance.
The submitted setup workflow performs the full storage reconciliation and can
surface storage blockers in the UI after the UI is available.

The control-plane pod does not mount the host k3s admin kubeconfig. It mounts
only the host-agent socket directory at `/run/alga-appliance` for diagnostics.
Its entrypoint writes an in-cluster kubeconfig from the service account token at
`/tmp/alga-appliance/kubeconfig`. In v1 that service account is bound to an
explicit broad setup ClusterRole, not Kubernetes `cluster-admin`, because setup
still shells out to `kubectl` and `flux install` to create CRDs, RBAC, storage,
Flux controllers, namespaces, Secrets, and HelmReleases. Narrow this permission
once setup moves to typed in-cluster API operations.

## Fallback Recovery

If the setup UI does not appear but k3s is available, reapply the baked bundle:

```bash
sudo /opt/alga-appliance/bin/alga-control-plane-reapply
```

The fallback command is safe to rerun. It imports baked image archives, applies
storage best-effort, recreates the setup token Secret from the host token, and
uses `kubectl apply` for control-plane manifests. It must not delete namespaces,
host-backed setup state, Secrets, HelmReleases, or application data.

## Logs And Diagnostics

Start with:

```bash
sudo journalctl -u alga-appliance-bootstrap.service -u k3s -f
sudo kubectl --kubeconfig /etc/rancher/k3s/k3s.yaml -n alga-appliance-control-plane get pods,svc,cm,secrets
sudo kubectl --kubeconfig /etc/rancher/k3s/k3s.yaml -n alga-appliance-control-plane logs deploy/appliance-control-plane --all-containers --tail=400
```

For broader support collection, use the setup/status UI support bundle or:

```bash
sudo /usr/bin/env node /opt/alga-appliance/host-service/support-bundle.mjs
```

When run on the host, the support bundle includes host bootstrap logs, k3s
service status, control-plane resources and logs, Flux resources, HelmReleases,
app bootstrap jobs, and redacted setup metadata. When generated from the
Kubernetes control-plane pod, it first asks `alga-host-agent.service` over
`/run/alga-appliance/host-agent.sock` for host journal/systemd diagnostics, then
adds cluster diagnostics. The socket is owned by host group `alga-appliance`
(GID `10001`), which is reserved through `/etc/sysusers.d/alga-appliance.conf`
and matches the control-plane pod group. If the socket is unavailable, the
bundle includes a note telling support to run the host command for
systemd/journal diagnostics.

## Fresh-Install Smoke Test

For a newly built ISO:

1. Boot a fresh VM with no external registry or GitHub dependency required
   before setup UI availability.
2. Confirm `alga-appliance-bootstrap.service` completes or reports an actionable
   blocker.
3. Open the console setup URL on port `8080`.
4. Submit release channel, app URL, DNS mode, tenant, and initial admin inputs.
5. Confirm setup progresses through release selection, Flux source/runtime
   values, initial tenant Secret creation, application bootstrap, and login
   readiness.
6. Re-run `alga-control-plane-reapply` and confirm setup/status remains
   available and application data is not deleted.
