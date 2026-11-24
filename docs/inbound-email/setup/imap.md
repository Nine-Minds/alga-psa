# IMAP In-App Processing Flags

Use these environment variables to control IMAP webhook execution mode for inbound email processing.

## Core in-app enablement

- `IMAP_INBOUND_EMAIL_IN_APP_PROCESSING_ENABLED=true`
  - Enables IMAP webhook in-app processing for all tenants/providers.
- `IMAP_INBOUND_EMAIL_IN_APP_TENANT_IDS=<tenant-a,tenant-b>`
  - Enables IMAP in-app mode for specific tenants.
- `IMAP_INBOUND_EMAIL_IN_APP_PROVIDER_IDS=<provider-a,provider-b>`
  - Enables IMAP in-app mode for specific providers.

The IMAP-specific flags are OR-ed with the shared in-app flags:

- `INBOUND_EMAIL_IN_APP_PROCESSING_ENABLED`
- `INBOUND_EMAIL_IN_APP_TENANT_IDS`
- `INBOUND_EMAIL_IN_APP_PROVIDER_IDS`

## Unified pointer queue handoff

- IMAP webhook ingestion now uses unified pointer queue handoff only (`handoff: "unified_pointer_queue"`).
- Legacy in-memory IMAP async queue controls were removed.
- `IMAP_WEBHOOK_SECRET` must be set to the same non-empty random value for the
  server and email-service containers. The email-service sends it as
  `x-imap-webhook-secret`; the server rejects IMAP webhook requests when it is
  missing or mismatched.

## Artifact concurrency bound

- `IMAP_INBOUND_EMAIL_IN_APP_ARTIFACT_CONCURRENCY=1..8`
  - Bounds per-message attachment artifact processing concurrency.
- `INBOUND_EMAIL_IN_APP_ARTIFACT_CONCURRENCY=1..8`
  - Shared fallback env used when IMAP-specific value is unset.

## Ingress caps honored by webhook

- `IMAP_MAX_ATTACHMENT_BYTES`
- `IMAP_MAX_TOTAL_ATTACHMENT_BYTES`
- `IMAP_MAX_ATTACHMENT_COUNT`
- `IMAP_MAX_RAW_MIME_BYTES`

The IMAP webhook enforces these caps before in-app persistence and records structured `ingressSkipReasons` for over-limit artifacts.

## Private mail servers

IMAP connections are checked against an outbound-target policy before any
socket opens. Every DNS answer for the mailbox host must be a public address,
and the connection is pinned to the address that was checked. A mailbox whose
host resolves to a private address (RFC 1918 IPv4 or IPv6 unique-local) is
refused by default, both in **Test connection** and in the live listener.

To allow an on-premises or VPN-only mail server, list its exact hostnames or IP
addresses in `EMAIL_PROVIDER_IMAP_PRIVATE_TARGET_ALLOWLIST`:

```dotenv
EMAIL_PROVIDER_IMAP_PRIVATE_TARGET_ALLOWLIST=imap.internal.example,10.40.8.12
```

- Set the same value on **both** the server and the email-service containers
  (Helm: `imap.privateTargetAllowlist` in both charts), then restart or roll
  out both. The server uses it for connection tests, OAuth callbacks and
  recovery of auth-paused providers; email-service uses it for the live
  listener and inbound queue fetches.
- Set it **before** upgrading a deployment that already reads a private
  mailbox, or that mailbox stops syncing after the upgrade.
- Entries are exact matches only. Wildcards, CIDR ranges, URLs and ports are
  not accepted. Loopback, link-local, metadata and CGNAT addresses stay blocked
  even when listed.
- Custom IMAP ports (1–65535) are accepted and go through the same checks.
- The IMAP OAuth token endpoint is not covered by this allowlist. It must be a
  public HTTPS endpoint on port 443.

For OAuth mailboxes, the stored mailbox tokens are bound to the token endpoint
they were issued by. Changing the provider's token endpoint clears those tokens
and the mailbox must be authorized again.

The full operator contract is in
[Private IMAP target allowlist](../../security/email-provider-private-target-allowlist.md).
