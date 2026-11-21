# Private IMAP target allowlist

`EMAIL_PROVIDER_IMAP_PRIVATE_TARGET_ALLOWLIST` is a deployment-only environment variable for installations whose inbound mail server is reachable at a private address. It is read by server-side policy; it is not accepted from tenant configuration or action arguments.

The value is a comma-separated list of **exact hostnames or IP literals**. Hostnames are lowercased, converted to ASCII form, and compared after removing a trailing dot. IPv6 literals may be bracketed. Wildcards, URL values, ports, paths, and CIDR ranges are not supported. Empty or unset means no private IMAP target is allowed (the default).

```dotenv
# One internal DNS name and one fixed address, if both are used by this deployment:
EMAIL_PROVIDER_IMAP_PRIVATE_TARGET_ALLOWLIST=imap.internal.example,10.40.8.12
```

Every DNS answer is checked before connecting. An exact allowlist match permits only RFC 1918 IPv4 or IPv6 unique-local answers. This trusts that host's DNS answers within those ranges. Loopback, link-local/metadata, CGNAT, and reserved answers remain blocked even for an allowlisted hostname. Other hosts remain subject to the default-deny policy. Loopback aliases (`localhost` and `*.localhost`), malformed hosts, and prohibited schemes remain rejected even when private targets are enabled. IMAP connections are limited to ports 143 and 993.

The policy covers provider connection tests, auth-paused lifecycle recovery, inbound queue worker sockets, the live email-service listener, and the IMAP OAuth callback. The HTTP OAuth token endpoint must use HTTPS on port 443, may not resolve to private or reserved addresses, and does not inherit the IMAP allowlist. Requests disable redirects and use a pinned HTTPS agent. IMAP transports use the selected validated address through ImapFlow's lookup callback, so the socket does not perform a second DNS resolution. A hostname with any unsafe DNS answer is rejected before a connection; after all answers pass, the transport pins to one checked answer.

Webhook delivery retains its separate `WEBHOOK_SSRF_ALLOW_PRIVATE=true` deployment override and is not affected by this IMAP exception.

## Deployment configuration

The application and inbound mail worker are separate processes. Configure the
same exact entries for both:

- **Docker Compose:** set `EMAIL_PROVIDER_IMAP_PRIVATE_TARGET_ALLOWLIST` in the
  deployment `.env`. The CE, EE, prebuilt, and production Compose definitions
  pass it to both `server` and `email-service`.
- **Helm:** set `imap.privateTargetAllowlist` in the application chart values
  for `alga-core` and in the email-service chart values for `email-service`.
  The single-node appliance has separate Helm releases and separate values
  files for these workloads, so configure both values sources and reconcile
  both releases. Keep the entries in the operator-managed release source so a
  channel update does not remove them.

Set the value before upgrading an existing deployment that uses a private
mailbox. After changing it, recreate or roll out both `server` and
`email-service` so each process loads the new environment. The server uses the
policy for provider connection tests, OAuth callbacks, and auth-paused recovery.
The email-service process uses it for its live IMAP listener and inbound queue
fetches. The workflow worker does not open these IMAP sockets.

IMAP ports are validated as integers from 1 through 65535. Standard ports 143
and 993 remain supported, and custom ports are accepted. The provider's
`secure` and `allow_starttls` settings continue to control TLS and STARTTLS;
the allowlist does not change transport security settings.

## Reproducible evidence

The regression `ee/appliance/host-service/tests/imap-private-allowlist-rendering.test.mjs`
renders both Helm charts with `imap.internal.example,10.40.8.12` and checks the
resulting application and email-service Deployments receive the environment
value. Run it with:

```sh
node --test ee/appliance/host-service/tests/imap-private-allowlist-rendering.test.mjs
```

`shared/services/email/__tests__/imapOutboundTarget.security.test.ts` exercises
default denial, exact-host opt-in, rejected prohibited addresses, mixed DNS
answers, the pinned address, OAuth endpoint isolation, and a custom port.
`packages/integrations/src/actions/email-actions/emailProviderActions.ssrf.test.ts`
exercises the protected provider connection path, including a configured
private host on a custom port, as well as denial before credential access.
