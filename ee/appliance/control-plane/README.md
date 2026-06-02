# Appliance Control Plane

This directory contains the Kubernetes-hosted setup/status control plane for new
Ubuntu/k3s appliance installs.

The image is built from the repository root:

```bash
docker build -f ee/appliance/control-plane/Dockerfile -t localhost/alga-appliance-control-plane:baked .
```

The Dockerfile builds the existing static status UI from
`ee/appliance/status-ui` and runs the existing setup/status API from
`ee/appliance/host-service/server.mjs`. The runtime image serves the static UI
from `/opt/alga-appliance/status-ui/dist` and listens on port `8080`, matching
the installed Kubernetes manifests under `manifests/`.

The ISO build stages this image as a k3s/containerd image archive so first setup
does not need an external registry pull.

Build and stage the bundle into an ISO overlay with:

```bash
ee/appliance/ubuntu-iso/scripts/stage-host-artifacts.sh --overlay-root <overlay-root> --build-control-plane-image
```

The runtime entrypoint creates an in-cluster kubeconfig from the service account
token; it does not mount the host k3s admin kubeconfig.
