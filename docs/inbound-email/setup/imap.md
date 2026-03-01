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
