# Huntress Integration — Design

Huntress is a managed security platform whose SOC reviews detections and
publishes incident reports. This integration turns those incident reports into
Alga tickets automatically: an MSP connects a Huntress account with an API key,
maps Huntress organizations to Alga clients, and every SOC-reviewed incident
becomes a routed, self-contained ticket — with no one watching the Huntress
portal.

It is the first security-monitoring integration. It reuses the RMM integration
data model (`rmm_integrations`, `rmm_organization_mappings`, `rmm_alerts`) with
`provider = 'huntress'`, ships EE-only like NinjaOne, and appears in the
integrations settings under a new "Security" section.

## Goals

1. **Incident → ticket, automatic.** Open incident reports become tickets via a
   polling engine; no manual steps after setup.
2. **Org mapping that fails safe.** Huntress organization → Alga client, with a
   mapping screen and exact-name auto-match. Incidents for unmapped
   organizations become tickets on a designated fallback client and triage
   board — never silently dropped.
3. **Routing config.** Severity → priority mapping, target board, and optional
   category/subcategory, so security tickets land on the security board.
4. **Dedup / update-in-place.** One incident = one ticket; later incident
   updates append internal notes to the existing ticket.
5. **Self-contained tickets.** Body contains the SOC summary, indicator types,
   affected host details, remediation steps, and a deep link into the Huntress
   portal.

## Non-goals (deferred)

- **Webhook ingestion.** Huntress webhooks are configured manually in their
  portal and their payloads are not part of the public OpenAPI spec. The poller
  is the sole ingestion path. If a webhook endpoint is added later, it should
  only *trigger* an immediate poll cycle ("poke"), never be trusted as a data
  source.
- **Write-back to Huntress** (`POST /v1/incident_reports/{id}/resolution`).
- **Escalations and signals ingestion** (`/v1/escalations`, `/v1/signals`).
  The poller's processor is structured so a second entity stream can be added.
- **Per-client routing overrides.** Day-one routing is per-integration. The
  existing `rmm_alert_rules` engine
  (`ee/server/src/lib/integrations/ninjaone/alerts/alertProcessor.ts`) is a
  natural future home for this; it is untouched by this work.
- **Huntress agent → asset sync engine.** Agents are looked up on demand for
  ticket context and best-effort asset linking only.

## External API constraints

Source of truth: the Huntress public API (OpenAPI spec, `api.huntress.io`).

- **Auth:** HTTP Basic — `Base64(api_key:api_secret)`. Keys are generated
  per-account at `<subdomain>.huntress.io/account/api_credentials`. There is no
  OAuth and no partner-tier API.
- **Rate limit:** 60 requests/minute per account, sliding window.
- **Incident reports:** `GET /v1/incident_reports` supports `limit` (≤500),
  `page_token`, `sort_field` (`id|created_at|updated_at`), `sort_direction`,
  and filters (`status`, `severity`, `platform`, `organization_id`,
  `agent_id`, `indicator_type`). **There is no "updated since" filter** — the
  poller must walk pages sorted by `updated_at desc` until it passes its
  cursor.
- **Incident fields used:** `id`, `organization_id`, `agent_id`, `severity`
  (`low|high|critical`), `status` (`sent|closed|dismissed|auto_remediating|
  deleting|partner_dismissed`), `subject`, `summary`, `body`,
  `indicator_types`, `indicator_counts`, `platform`, `remediations` (first 10
  inline), `sent_at`, `status_updated_at`, `closed_at`, `updated_at`.
- **Organizations:** `GET /v1/organizations` — `id`, `name`, `key`.
- **Agents:** `GET /v1/agents/{id}` — `hostname`, `platform`, `os`,
  `ipv4_address`, `external_ip`, `serial_number`, `last_callback_at`.
- **Account:** `GET /v1/account` — `name`, `subdomain`. The subdomain is
  captured at connect time to build portal deep links.

## Data model

No new tables. One migration-free reuse of the RMM schema
(`server/migrations/20251124000001_create_rmm_integration_tables.cjs`);
`rmm_integrations.provider` is an unconstrained string, so `'huntress'` needs
no migration.

### `rmm_integrations` (one row per tenant)

- `provider = 'huntress'`, `instance_url` = API base URL (default
  `https://api.huntress.io`), `is_active`, `connected_at`, `sync_status`,
  `sync_error`, `last_incremental_sync_at`.
- `settings` JSONB:

```jsonc
{
  "accountName": "Acme MSP",
  "accountSubdomain": "acmemsp",          // for portal deep links
  "incidentCursor": "2026-06-09T14:00:00Z", // max updated_at fully processed
  "pollIntervalMinutes": 5,
  "backfillDays": 7,
  "severityPriorityMap": {                 // huntress severity -> priority_id
    "critical": "<uuid>",
    "high": "<uuid>",
    "low": "<uuid>"
  },
  "boardId": "<uuid>",                     // required: security board
  "categoryId": "<uuid|null>",
  "subcategoryId": "<uuid|null>",
  "fallbackClientId": "<uuid>",            // required before polling activates
  "fallbackBoardId": "<uuid>",             // required: triage board
  "autoCloseTickets": false,
  "closedStatusId": "<uuid|null>"          // used when autoCloseTickets = true
}
```

### `rmm_organization_mappings` (one row per Huntress organization)

- `external_organization_id` = Huntress org id (stringified),
  `external_organization_name`, `client_id` (null = unmapped),
  `auto_create_tickets` (default true), `metadata.auto_matched` flag.
- Unique on `(tenant, integration_id, external_organization_id)`.

### `rmm_alerts` (one row per incident report)

- `external_alert_id` = Huntress incident id (stringified) — the unique
  constraint `(tenant, integration_id, external_alert_id)` is the dedup
  guarantee.
- `severity` = Huntress severity, `status` = Huntress status, `message` =
  incident `subject`, `device_name` = agent hostname when known,
  `external_device_id` = agent id, `asset_id` when an asset match is found,
  `ticket_id` once a ticket exists, `triggered_at` = `sent_at`.
- `metadata` JSONB: incident snapshot (`summary`, `indicator_types`,
  `indicator_counts`, `platform`, `organization_id`, remediation summaries,
  `status_updated_at`, portal URL, processing-error details when a cycle
  fails on this incident).

### `tenant_external_entity_mappings`

When an incident's agent is matched to an existing Alga asset:
`integration_type = 'huntress'`, `alga_entity_type = 'asset'`,
`external_entity_id` = agent id, `external_realm_id` = org id.

### Tickets

- `source = 'huntress'`, `source_reference` = incident id.
- `board_id`, `priority_id`, `category_id`/`subcategory_id` from routing
  config; `client_id` from the org mapping (or fallback client).

## Components

All new code is EE, under `ee/server/src/lib/integrations/huntress/`,
mirroring the NinjaOne layout (`ee/server/src/lib/integrations/ninjaone/`):

```
huntress/
  huntressClient.ts          REST client: Basic auth, throttle to 60 req/min,
                             429 backoff, page_token pagination
  incidents/
    incidentPoller.ts        cursor walk + dispatch, transport-wrapped
    incidentProcessor.ts     upsert rmm_alerts; create / note / close decisions
    ticketCreator.ts         builds the self-contained ticket (NinjaOne
                             ticketCreator pattern: transaction, default status,
                             ticket number, comment thread + internal note)
  organizations/
    orgSync.ts               org fetch -> mapping upsert + name auto-match
```

Supporting pieces:

- **Server actions:** `ee/server/src/lib/actions/integrations/huntressActions.ts`
  — connect (validate via `GET /v1/account`, store secrets, upsert integration
  row, initial org sync), disconnect, get status, update settings, sync
  organizations, update a mapping row.
- **Secrets:** tenant-scoped via `ISecretProvider`
  (`packages/core/src/lib/secrets/ISecretProvider.ts`):
  `huntress_api_key`, `huntress_api_secret`.
- **Settings UI:**
  `ee/server/src/components/settings/integrations/HuntressIntegrationSettings.tsx`
  (connect card, routing config, poll/auto-close settings) and
  `.../integrations/huntress/OrganizationMappingManager.tsx` (org table,
  client picker, auto-match indicators, per-row ticket toggle, unmapped-count
  badge, re-sync). Wired into
  `packages/integrations/src/components/settings/integrations/RmmIntegrationsSetup.tsx`
  via the `@enterprise` dynamic-import pattern.
- **Provider registry:**
  `packages/integrations/src/lib/rmm/providerRegistry.ts` gains a
  `category: 'rmm' | 'security'` field; Huntress registers with
  `category: 'security'`, `requiresEnterprise: true`. The setup page renders
  one card section per category.
- **Scheduling/transport:** the poll entry point runs through
  `runRmmSyncWithTransport()`
  (`ee/server/src/lib/integrations/rmm/sync/syncOrchestration.ts`):
  `HUNTRESS_SYNC_TRANSPORT` → `RMM_SYNC_TRANSPORT` → `'direct'`. A recurring
  job registered with the existing job scheduler
  (`packages/jobs/src/lib/jobs/jobScheduler.ts`) iterates active Huntress
  integrations on each tick and skips tenants whose `pollIntervalMinutes`
  hasn't elapsed since `last_incremental_sync_at`.

## Flows

### Connect

1. User enters API key + secret (and optionally a base URL) in the Huntress
   settings card.
2. Action calls `GET /v1/account`; on success stores secrets, upserts the
   `rmm_integrations` row with `accountName`/`accountSubdomain`, and runs the
   initial org sync.
3. Polling stays inactive until routing config is complete: `boardId`,
   `fallbackClientId`, `fallbackBoardId`, and a full `severityPriorityMap`
   (pre-filled at connect by case-insensitive name match against the tenant's
   priorities: Critical/Urgent, High, Medium).

### Organization sync & auto-match

1. Fetch all organizations; upsert mapping rows by external org id (names
   refresh on every sync).
2. For rows with `client_id IS NULL`, compare normalized names
   (lowercase, collapse whitespace, strip punctuation) against the tenant's
   clients. An exact normalized match links the client and sets
   `metadata.auto_matched = true`; anything weaker is left unmapped for the
   user. Auto-matched rows are visibly flagged in the UI and editable.

### Poll cycle (per integration)

1. List `/v1/incident_reports` sorted `updated_at desc`, page size 500,
   collecting rows until one is older than `incidentCursor − 60s` (overlap
   absorbs clock skew; dedup makes reprocessing harmless). First run instead
   collects back to `now − backfillDays`.
2. Process collected incidents in ascending `updated_at` order through the
   incident processor.
3. Advance `incidentCursor` past each successfully processed incident; stop
   advancing at the first failure (that incident and everything newer is
   retried next cycle) and record the error on the alert row's metadata.
4. On auth or API failure: `sync_status = 'error'`, `sync_error` set, banner
   in the settings UI. Nothing is lost — incidents remain in Huntress and the
   cursor resumes when the credential is fixed.

### Incident processing

For each incident, upsert the `rmm_alerts` row, then:

- **New, status open (`sent`, `auto_remediating`):** resolve the org mapping.
  - Mapped client and `auto_create_tickets` on → create ticket with routing
    config.
  - Unmapped org (no row, or `client_id IS NULL`) → fetch and upsert the org
    mapping row if it's unknown, then create the ticket on
    `fallbackClientId`/`fallbackBoardId` with an `[Unmapped Org]` title prefix
    and a note explaining how to map the organization.
  - `auto_create_tickets` explicitly off on the mapping row (mapped or not) →
    record the alert row only; the user opted that organization out.
- **New, status already closed/dismissed** (backfill case): record the alert
  row without a ticket.
- **Status `deleting`:** skip.
- **Existing row, changed** (`updated_at`, status, or remediation state):
  append an internal note to the linked ticket describing what changed. If the
  new status is `closed`, `dismissed`, or `partner_dismissed` and
  `autoCloseTickets` is on, also move the ticket to `closedStatusId`.

Ticket creation and the alert-row `ticket_id` update happen in one
transaction; the dedup constraint plus the `ticket_id` check make creation
idempotent across overlapping polls.

### Ticket content

Title: `[Huntress] <severity> — <subject>` (fallback tickets additionally get
the `[Unmapped Org]` prefix). Body sections:

1. **Incident** — severity, status, SOC analyst summary, indicator types and
   counts, platform, sent/updated timestamps.
2. **Affected host** — hostname, OS, internal/external IPs, serial number,
   last callback (from `GET /v1/agents/{id}`; omitted for host-less incidents
   such as `microsoft_365` identity cases, which show the org context
   instead).
3. **Remediations** — the inline remediation steps with status.
4. **Links** — deep link to the incident in the Huntress portal, built from
   `accountSubdomain`. The exact portal path is confirmed against a live
   account during implementation; the builder is isolated in one function so
   a path correction is a one-line change.

An internal note (NinjaOne `ticketCreator.ts` pattern: comment thread first,
then the internal-note comment) records the raw incident identifiers for
audit.

### Asset linking (best effort)

If the incident has an `agent_id` and the org is mapped: look up the agent,
match `hostname` case-insensitively (tie-break on `serial_number`) against
the mapped client's assets. A unique match links the ticket via
`asset_associations`, sets `rmm_alerts.asset_id`, and upserts the
`tenant_external_entity_mappings` row. Ambiguous or missing matches skip
linking — host details are already in the body.

## Error handling summary

| Failure | Behavior |
| --- | --- |
| Huntress 401/403 | Integration `sync_status='error'` + UI banner; poll resumes on fix; no data loss |
| Huntress 429 | Client-side throttle should prevent it; on occurrence, back off and finish the cycle late |
| Per-incident processing error | Cursor stops before it; error stored in alert metadata; retried next cycle |
| Unmapped organization | Ticket on fallback client/triage board, flagged — never dropped |
| Unknown org id mid-poll | Org fetched on demand, unmapped mapping row created, fallback routing |
| Fallback config missing | Polling refuses to activate; settings UI requires it during setup |
| Agent lookup failure | Ticket still created; host section omitted with a note |

## Testing

- **Unit (mocked client interface):** cursor walker — pagination, overlap
  window, backfill, failure-stops-cursor; incident processor — every state
  transition (new/update/close × mapped/unmapped/auto-create-off ×
  auto-close on/off); severity→priority resolution; name-normalization
  auto-match; ticket-body builder (host-less incidents, remediation
  rendering, deep link).
- **Integration (repo harness, seeded tenant):** connect → org sync →
  poll → ticket created with correct board/priority/category → second poll
  with an updated incident appends a note, not a ticket → closed incident
  with auto-close on resolves the ticket; unmapped-org incident lands on the
  fallback client/board.
- **Manual smoke:** against a real Huntress account — verify the portal deep
  link path and the 60 req/min throttle behavior.
