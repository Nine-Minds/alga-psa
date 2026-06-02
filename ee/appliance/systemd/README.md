# Appliance Systemd Units

New Ubuntu/k3s installs use `alga-appliance-bootstrap.service` as the primary
host entrypoint. That service only initializes the setup token and temporary
local-admin credential, starts the minimal Kubernetes substrate through
`bootstrap-control-plane.sh`, applies the baked control-plane bundle, and hands
setup/status to Kubernetes.

The legacy host API service is not part of the new-install primary path. The
host keeps only bootstrap, console, fallback scripts, and `alga-host-agent.service`.
The host agent listens on `/run/alga-appliance/host-agent.sock` and exposes a
small diagnostics-only Unix-socket API for the Kubernetes control plane to
request host journals/systemd status without making the pod privileged.
