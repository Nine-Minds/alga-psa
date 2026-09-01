# Appliance support agent

This image is a purpose-built, outbound-only supervisor for one appliance support
window. It consumes a one-use connector token, authenticates the appliance role
on the relay, records PTY input/output/control events before forwarding them, and
launches a single host-root shell through `nsenter`.

The pod must provide host PID and mount namespaces, a privileged security context,
and a host recording directory. It does not accept inbound connections, expose a
port, or receive the long-lived appliance credential. The host service owns
replacement and reboot resume by exchanging the root-local resume grant with the
central control plane.

The image is only usable when the appliance release manifest contains the exact
digest-pinned `ghcr.io/nine-minds/alga-appliance-support-agent` reference and the
central relay reports both appliance and recorder readiness.
