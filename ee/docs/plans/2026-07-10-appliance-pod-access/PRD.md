# PRD — Appliance pod access

- Slug: `appliance-pod-access`
- Date: `2026-07-10`
- Status: Implementation complete; live smoke test pending

## Summary

Add interactive pod terminals and temporary pod port forwards to the appliance
management UI. An authenticated appliance administrator can select a running
pod and container, open a bash or sh session, or expose a pod TCP port on the
appliance LAN for a bounded period.

## Problem

Appliance administrators can inspect deployments, pods, and logs from the setup
UI, but deeper investigation still requires host shell access and direct
`kubectl` commands. This slows support work and keeps useful Kubernetes
diagnostics behind a separate operating-system credential.

## Goals

- Open an interactive terminal in a selected running pod container.
- Detect bash or sh automatically while allowing an explicit shell choice.
- Forward a selected pod TCP port to a specified or automatically allocated
  appliance LAN port.
- Make active forwards visible, extendable, and immediately stoppable.
- Bound terminal and forward lifetimes and clean up resources reliably.
- Ship the feature through the appliance control-plane image update path.

## Non-goals

- Persist or reconnect terminal sessions after a disconnect or control-plane
  restart.
- Persist port forwards after a control-plane restart.
- Provide file upload, file download, command history, terminal recording, or
  collaborative terminal sharing.
- Forward UDP traffic or target Kubernetes Services and Deployments directly.
- Add another password prompt or a separate appliance role model.
- Authenticate clients after they connect to an active LAN-facing forwarded
  port.
- Replace SSH or offer a general host operating-system terminal.

## Users and Primary Flows

The user is an appliance administrator who has authenticated to the setup/status
UI with the appliance management password.

### Open a container shell

1. Select **Open shell** from a pod row or open the **Access** tab.
2. Choose a namespace, pod, container, and Auto, bash, or sh.
3. Connect and use the xterm terminal.
4. Disconnect explicitly or leave the tab. The server closes the Kubernetes
   exec stream.

### Forward a pod port

1. Select **Forward port** from a pod row or open the **Access** tab.
2. Choose a namespace, pod, container, and remote port.
3. Optionally enter an appliance-side port and choose a duration.
4. Start the forward and use the displayed `appliance-ip:local-port` address.
5. Extend or stop the forward from the active-forwards list.

## UX / UI Notes

- Add **Access** to the status UI navigation beside Pods and Logs.
- Pod rows keep the current log action and add **Open shell** and **Forward
  port** actions.
- The Access tab uses shared namespace, pod, and container selectors.
- The terminal toolbar includes Auto, bash, and sh plus Connect and Disconnect.
- Version one permits one terminal per browser tab.
- The port form offers declared container ports and accepts a manually entered
  remote port.
- The local port is optional. An omitted value receives an available high port.
- Duration choices are 30 minutes, 1 hour, 4 hours, and 8 hours.
- Active forwards show target, address, state, creation time, expiration, and
  Copy, Extend, and Stop actions.
- A persistent warning explains that forwarded ports are reachable without UI
  authentication from the appliance LAN.
- Empty, loading, unavailable-shell, permission, port-conflict, pod-replaced,
  expired, and disconnected states have explicit messages.

## Requirements

### Functional Requirements

- The control plane must use the official Kubernetes JavaScript client for exec
  and port-forward streams.
- The browser terminal must use `@xterm/xterm` with responsive resizing.
- The exec connection must relay stdin, stdout, stderr, terminal dimensions,
  exit status, and structured failures.
- Auto shell selection must attempt bash and fall back to a new sh exec stream.
- A shell-less image must produce a clear terminal error.
- A forward must target a running pod by name and UID plus a numeric remote TCP
  port.
- The server must bind the forward only to the appliance IPv4 address that
  received the authenticated management request.
- An administrator may request an available local port or let the server
  allocate one from a configurable high-port range.
- A forward must accept multiple TCP connections until stopped or expired.
- The API must support listing, extending, and stopping active forwards.
- Pod deletion, replacement, or transition out of Running must stop related
  terminals and forwards.
- Control-plane shutdown must close all exec streams, listeners, and accepted
  TCP connections.

### Non-functional Requirements

- Terminal idle timeout: 30 minutes, reset by input or output.
- Maximum concurrent terminal sessions: 4 per appliance.
- Maximum active port forwards: 16 per appliance.
- Maximum forward duration: 8 hours.
- Terminal output must use bounded WebSocket buffering.
- Session and listener state remains in memory only.
- Existing setup, status, logs, recovery, update, and support-bundle behavior
  must remain available.

## Data / API / Integrations

- Add a WebSocket upgrade endpoint under `/api/k8s/exec`.
- Use a small typed message protocol for terminal input, output, resize, ready,
  exit, and error messages.
- Add authenticated REST endpoints under `/api/k8s/port-forwards` to create and
  list forwards, plus per-forward extend and stop operations.
- Extend the existing pod summary response with declared container ports.
- Load the Kubernetes client from the control plane's generated in-cluster
  kubeconfig.
- Keep the current serialized `kubectl` queue for bounded existing operations.

## Security / Permissions

- Require the existing signed appliance management-session cookie.
- Require same-origin requests for exec WebSockets and port-forward mutations.
- Do not require step-up password authentication.
- Validate Kubernetes names, shell choices, ports, durations, and request sizes
  before starting a stream or listener.
- Add only `create` on `pods/exec` and `pods/portforward` to the canonical
  appliance control-plane ClusterRole.
- Run an idempotent startup migration that adds those exact rules to the known
  ClusterRole on existing appliances. If it fails, disable Access while leaving
  the rest of the UI healthy.
- Do not log terminal input, output, or forwarded payloads.

## Observability

- Log terminal and forward lifecycle events with client address, Kubernetes
  target, ports when applicable, timestamps, and stop reason.
- Return structured failures to the UI for validation, RBAC, Kubernetes stream,
  timeout, conflict, and capacity errors.
- Expose active forward state through the authenticated list endpoint.

## Rollout / Migration

- Update the canonical control-plane RBAC manifest for future ISO builds.
- Use the startup RBAC migration so existing appliances do not require a new ISO.
- Build and hot-test the control-plane image on the local appliance.
- Publish the accepted commit with
  `alga-appliance-control-plane-build-publish` and move the stable control-plane
  pointer.
- No application image, Helm chart, Flux configuration, or database migration is
  required.

## Open Questions

None. Full browser and live-container smoke coverage is intentionally performed
after the implementation rather than as part of the initial automated test set.

## Acceptance Criteria (Definition of Done)

- An authenticated administrator can open a working Auto, bash, or sh terminal
  in a selected running container.
- Terminal input, output, resizing, exit, idle timeout, disconnect, and pod
  replacement behave as specified.
- An authenticated administrator can start a random or explicit local TCP
  forward to a selected pod port.
- Active forwards can be listed, copied, extended, stopped, and automatically
  expire.
- Forwarded traffic reaches the selected pod and stops immediately when the
  listener closes.
- Unauthenticated, cross-origin, invalid, over-limit, and RBAC-denied requests
  fail without disrupting other management features.
- Existing appliances receive the narrow RBAC addition from the new control-
  plane image without requiring a new ISO.
- Critical unit checks and production UI/control-plane builds pass.
- The feature is committed, reviewed, and ready for the separate smoke-test pass.
