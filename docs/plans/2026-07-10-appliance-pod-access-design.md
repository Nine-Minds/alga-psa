# Appliance pod access design

## Outcome

The appliance management UI can open an interactive shell in a running pod
container and expose a pod port temporarily on the appliance LAN. Both features
use the existing management session and stop automatically when their configured
lifetime ends.

## Chosen approach

Use the official Kubernetes JavaScript client in the appliance control plane.
Its exec client provides the stdin, output, status, and terminal-resize streams
needed by a browser terminal. Its port-forward client can attach accepted TCP
connections directly to a pod without supervising a `kubectl` subprocess.

The status UI uses `@xterm/xterm` and its fit addon. The host service uses `ws`
for browser WebSocket upgrades and Node TCP listeners for LAN-facing forwarded
ports. The existing serialized `kubectl` queue remains responsible for bounded
status, log, and reconciliation commands.

## Control-plane components

The host service owns two in-memory managers:

- The exec manager authenticates a WebSocket request, validates its target, and
  opens a TTY-enabled Kubernetes exec stream. It relays terminal input, output,
  resize events, exit status, and structured errors.
- The port-forward manager creates, lists, extends, and stops TCP listeners. Each
  listener targets one pod UID and remote port. It accepts multiple connections
  until stopped or expired.

The HTTP server exposes one authenticated WebSocket upgrade path for exec and
authenticated REST operations for port-forward lifecycle management. New
requests must pass same-origin validation in addition to the existing signed
management-session cookie.

## Setup UI

Add an **Access** tab beside Pods and Logs. The tab contains shared namespace,
pod, and container selectors, a terminal workspace, a port-forward form, and an
active-forwards list. Pod rows provide **Open shell** and **Forward port** actions
that preselect the target and open this tab.

The shell selector offers Auto, bash, and sh. Auto attempts `bash`, then starts a
new exec stream with `sh` when bash is unavailable. Version one supports one
terminal per browser tab. Leaving the Access tab or disconnecting closes it.

The port-forward form requires a remote port. It offers ports declared by the
selected container and accepts a manually entered port. The appliance-side port
is optional. If omitted, the control plane allocates an available high port.
Duration choices are 30 minutes, 1 hour, 4 hours, and 8 hours.

Each active forward shows its target, reachable `appliance-ip:local-port`, state,
and expiration. The operator can copy the address, extend the lifetime, or stop
the forward. The UI keeps a visible warning that the port is reachable without
management authentication by devices that can reach the appliance LAN.

## Security and lifecycle

No additional password prompt is required. Inputs are validated against narrow
name, port, shell, and duration allowlists before a Kubernetes request starts.

Terminal sessions have a 30-minute idle timeout and a four-session appliance
limit. Input or output resets the idle timer. Browser disconnect, logout, pod
replacement, timeout, control-plane shutdown, or excessive buffered output ends
the session. Terminal commands and output are not persisted.

Port forwards bind only to the appliance IPv4 address that received the
management request. They have a sixteen-forward appliance limit and an eight-hour
maximum lifetime. Expiration, manual stop, pod deletion, pod replacement, or the
pod leaving Running state closes the listener and its active TCP connections.

Lifecycle logs include the requesting client address, Kubernetes target, ports,
timestamps, and stop reason. They do not include terminal input or forwarded
traffic.

## RBAC upgrade

The control plane needs `create` on `pods/exec` and `pods/portforward`. The
canonical ClusterRole manifest includes those exact subresources.

Existing appliances load the ClusterRole manifest from their ISO-installed host
filesystem, while the status UI and host service update through the control-plane
image pointer. The new image therefore performs a narrow, idempotent startup
migration against the known `appliance-control-plane-setup-admin` ClusterRole.
It adds only the missing exec and port-forward rules, then verifies access. If
the migration fails, the rest of the management UI stays available and the
Access tab reports the permission error.

## Failure handling

The API returns structured failures for invalid targets, non-running pods,
missing containers, unavailable shells, occupied local ports, expired sessions,
RBAC denial, Kubernetes stream failure, and configured limits. The UI shows the
failure next to the affected terminal or forward and does not leave stale active
state.

## Verification

Automated tests cover the critical boundary: authentication and origin checks,
input validation, shell fallback, cleanup timers, port conflicts, RBAC migration,
and production UI/control-plane builds. Full container and browser behavior is
validated in a separate smoke-test pass after implementation.

## Delivery

Build and hot-test a new appliance control-plane image on the local VM. Publish
the accepted commit with `alga-appliance-control-plane-build-publish`, then move
the stable control-plane pointer. The application images, Flux configuration,
and Helm charts do not change for this feature.
