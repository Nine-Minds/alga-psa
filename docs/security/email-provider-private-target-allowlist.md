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
