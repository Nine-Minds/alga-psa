# Remote support on the appliance

Remote support is available only to a connected Pro or Premium appliance when
the selected appliance release contains the approved support-agent image and the
central support service is reachable. Essentials, offline appliances, and a
release without a valid support-agent digest remain disabled.

## Customer consent and access

An authenticated appliance administrator enables a one-, four-, or eight-hour
window from Manage → Support. Access is root-equivalent. The appliance opens no
inbound port and does not run SSH for this feature. The support agent connects
outbound to the vendor relay over TLS.

The share code is single-use. The UI does not reveal it until the connector and
local recorder report readiness. The code is removed after redemption or closure.
The long-lived appliance credential is used only by the host service to create
the central session. It is never mounted into the privileged support pod, stored
in recording history, or included in logs and errors.

Only one support window, one bound operator, and one live shell are allowed. The
administrator can extend a window only along the one → four → eight-hour ladder.
The original activation time remains unchanged, so the absolute limit is eight
hours. Revocation removes local access immediately. A disconnected operator has
two minutes to reconnect to the same shell, and shell idle time is limited to 30
minutes.

## Local recordings

Terminal input, output, resize, reconnect, reboot, exit, and stop events are
recorded on the appliance before they are forwarded. Recordings use bounded,
versioned JSON lines with SHA-256 segment digests. Recording I/O failure or the
100 MB session limit terminates the shell before more input is accepted.

Closed recordings can be reviewed, downloaded, verified against central signed
receipts, or deleted from Manage → Support. Active recordings cannot be deleted.
The appliance prunes closed recordings after 30 days. Terminal content is not
sent to or persisted by the central control plane.

## Release and runtime contracts

The selected OCI release manifest may carry:

```json
{
  "supportAgent": "ghcr.io/nine-minds/alga-appliance-support-agent@sha256:<64 hex characters>"
}
```

The host service rejects tags, unexpected registries, and malformed digests. It
creates a pod in `alga-appliance-support` with a privileged/root security
context, host PID and host-root mount, no service-account token, an ephemeral
connector Secret, a memory-backed reconnect volume, and a session-scoped host
recording path. The connector Secret is removed after authenticated readiness.

The local state lives under `/var/lib/alga-appliance/support-sessions` with
`0700` directories and `0600` files. State and metadata use bounded reads and
atomic replacement. A reboot can resume the same unexpired, unrevoked window
through its root-local resume grant. It never creates a new code or extends the
original expiry.

## External dependencies

This appliance implementation depends on the separately owned central support
control API for entitlement verification, session state, code redemption,
operator binding, relay readiness, token exchange, and recording receipts. The
`alga-license` verifier route and the central control plane/relay are not part of
this repository. Until those services are deployed with their approved
authentication and persistence contracts, the local enable control remains
disabled and no usable support pod is provisioned.

For an ineligible or offline appliance, use the existing support-bundle flow.
