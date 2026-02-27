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

## Async queue mode

- `IMAP_INBOUND_EMAIL_IN_APP_ASYNC_ENABLED=true`
  - Webhook accepts payload and enqueues in-process work instead of running inline.
- `IMAP_INBOUND_EMAIL_IN_APP_ASYNC_WORKERS=1..8`
  - Controls max concurrent in-process queue workers.

## Fallback behavior

- `IMAP_INBOUND_EMAIL_IN_APP_EVENT_BUS_FALLBACK_ENABLED=true`
  - If in-app processing fails, publish `INBOUND_EMAIL_RECEIVED` to event bus as explicit fallback.
  - When unset/false, in-app failures do not auto-fallback to event bus.

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
