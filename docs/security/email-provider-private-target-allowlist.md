# Private IMAP target allowlist

`EMAIL_PROVIDER_IMAP_PRIVATE_TARGET_ALLOWLIST` is a deployment-only environment variable for installations whose inbound mail server is reachable at a private address. It is read by the server action; it is not accepted from tenant configuration or action arguments.

The value is a comma-separated list of **exact hostnames or IP literals**. Hostnames are lowercased, converted to ASCII form, and compared after removing a trailing dot. IPv6 literals may be bracketed. Wildcards, URL values, ports, paths, and CIDR ranges are not supported. Empty or unset means no private IMAP target is allowed (the default).

```dotenv
# One internal DNS name and one fixed address, if both are used by this deployment:
EMAIL_PROVIDER_IMAP_PRIVATE_TARGET_ALLOWLIST=imap.internal.example,10.40.8.12
```

Every DNS answer is checked. An exact allowlist match permits only RFC 1918 IPv4 or IPv6 unique-local answers. This trusts that host's DNS answers within those ranges. Loopback, link-local/metadata, CGNAT, and reserved answers remain blocked even for an allowlisted hostname. Other hosts remain subject to the default-deny policy. Loopback aliases (`localhost` and `*.localhost`), malformed URLs, and prohibited schemes remain rejected even when private targets are enabled. The setting affects only IMAP mail-server validation. OAuth token URLs remain HTTPS-only and may not resolve to private/reserved addresses. Webhook delivery retains its separate `WEBHOOK_SSRF_ALLOW_PRIVATE=true` deployment override.

The validator checks DNS before the transport resolves the name again. This is validate-then-connect; it does not pin the validated address, so DNS rebinding remains a residual risk for both the OAuth HTTP request and IMAP socket. See the human review guide for scope and verification.
