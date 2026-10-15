# Ticket external system links implementation plan

## Intent

Give tickets (and their comments) structured, queryable links to records in external systems — the Discord thread a ticket was raised in, the GitHub issue it mirrors, the vendor case it references — with the actor and identifiers needed to navigate back and, later, to update or notify that system from a subscriber (workflow, webhook, or out-of-process worker).

Two writers ship in this scope: the public REST API (so a bot, a GitHub Action, or a migration can populate links) and a manual "Add external link" affordance on the MSP ticket screen. Outbound delivery to any external system is explicitly **not** in scope; this work produces the data and the events a delivery subscriber needs.

## Code-grounded design

Today a ticket's provenance lives in two bespoke places:

- `tickets.email_metadata` (jsonb, `server/migrations/20250709012030_add_email_metadata_to_tickets.cjs`) — inbound-email threading; `packages/tickets/src/lib/ticketOrigin.ts` derives the display origin from it.
- `tenant_external_entity_mappings` (`server/migrations/20250502173321_create_tenant_external_entity_mappings.cjs`) — accounting/import sync. Its unique index `(tenant_id, integration_type, alga_entity_type, alga_entity_id)` allows exactly one external record per ticket per integration and its `sync_status`/realm semantics are accounting-shaped.

Neither fits "many external identities per ticket, at ticket and comment level, from arbitrary systems". Add a dedicated links table and a system registry rather than bending either.

### 1. System registry

**Built-in catalog (code).** New `packages/types/src/interfaces/externalSystem.interfaces.ts` exporting:

```ts
export interface ExternalSystemDefinition {
  key: string;             // 'discord' | 'github' | ... | 'custom:<slug>'
  label: string;
  icon: string;            // lucide icon name; UI maps to component
  urlTemplate?: string;    // '{realm}' and '{external_id}' placeholders
  realmLabel?: string;     // e.g. 'Repository', 'Server'
  originCategory: TicketOriginDisplay; // how an origin link maps to ticket_origin
}
export const BUILT_IN_EXTERNAL_SYSTEMS: readonly ExternalSystemDefinition[]
```

Initial entries: `discord`, `slack`, `github`, `jira`, `email`, `client_portal`, `api`, `generic` (no template; url required). Keys are lowercase `[a-z0-9_]+`.

**Tenant custom systems (DB).** `tenant_external_systems`: `(tenant, key, label, url_template, created_at, updated_at)`, PK `(tenant, key)`. Keys must match `custom:[a-z0-9_]+` and are validated to never collide with a built-in key. Managed from a new **External systems** tab in `server/src/components/settings/general/TicketingSettings.tsx` (extend `TICKETING_TAB_IDS`; follow the `ChecklistTemplatesSettings` pattern).

**Resolver.** `packages/tickets/src/lib/externalSystems.ts` — `resolveExternalSystem(tenantSystems, key)` returns a definition or `null`; `renderExternalLinkUrl(def, link)` fills the template, preferring an explicit `url` on the link.

### 2. Links table

`external_entity_links` (migration `server/migrations/20260913120000_create_external_entity_links.cjs`, following `20260610100000_create_ticket_close_rules_tables.cjs` for composite PK + `distributeIfCitus` + `addForeignKeyIfMissing`, `exports.config = { transaction: false }`):

| column | type | notes |
|---|---|---|
| tenant | uuid | PK part; FK tenants |
| link_id | uuid | PK part, `gen_random_uuid()` |
| entity_type | text | `'ticket'` \| `'comment'` (CHECK) |
| entity_id | uuid | ticket_id or comment_id |
| ticket_id | uuid | always set (denormalized for comment links) — one index serves "all links for this ticket"; FK `(tenant, ticket_id) → tickets` ON DELETE CASCADE |
| system | text | registry key |
| external_id | text | required |
| external_parent_id | text | nullable; for comment links, the ticket-level external id (thread / issue) |
| realm | text | nullable; repo, guild, workspace |
| url | text | nullable; explicit link-out overrides template |
| relationship | text | `'origin'` \| `'mirror'` \| `'reference'` (CHECK) |
| actor | jsonb | nullable `{ id?, handle?, display_name?, url? }` — who acted in the external system |
| external_status | text | nullable |
| external_updated_at | timestamptz | nullable |
| last_synced_at | timestamptz | nullable |
| metadata | jsonb | nullable free bag |
| created_by | uuid | nullable; FK users |
| created_at / updated_at | timestamptz | |

Indexes / constraints:
- `UNIQUE (tenant, system, external_id, COALESCE(external_parent_id, ''), entity_type)` — one Alga entity per external record per level.
- `UNIQUE (tenant, entity_type, entity_id) WHERE relationship = 'origin'` — at most one origin per entity.
- `INDEX (tenant, ticket_id)`; `INDEX (tenant, system, external_id)`.
- Comment links must reference a comment on `ticket_id` (enforced in the action, not a cross-table CHECK).

Register `external_entity_links: { scope: 'tenant' }` and `tenant_external_systems: { scope: 'tenant' }` in `packages/db/src/lib/tenantTableMetadata.ts`.

`email_metadata` is **not** migrated in this scope; the origin resolver keeps its existing branches.

### 3. Actions (`packages/tickets/src/actions/externalLinks/`)

`withAuth` + `tenantDb`, mirroring `checklists/ticketChecklistActions.ts`:

- `getTicketExternalLinks(ticketId)` — `ticket:read`; returns ticket-level and comment-level links, each with a resolved `display` (`label`, `icon`, `href`) so the UI never touches the registry.
- `addExternalLink(input)` — `ticket:update`. Validates: system key resolves; `external_id` non-empty; `url` valid http(s) if present; for `entity_type='comment'` the comment belongs to `ticket_id`; single-origin rule (return a structured `ExternalLinkError` code `origin_exists`, not a raw unique-violation). On success publishes `TICKET_EXTERNAL_LINK_ADDED`.
- `updateExternalLink(linkId, patch)` — `ticket:update`; mutable: `relationship`, `url`, `actor`, `external_status`, `external_updated_at`, `last_synced_at`, `metadata`. Publishes `TICKET_EXTERNAL_LINK_UPDATED`.
- `removeExternalLink(linkId)` — `ticket:update`. Publishes `TICKET_EXTERNAL_LINK_REMOVED`.
- `findTicketByExternalLink({ system, external_id, external_parent_id? })` — `ticket:read`; returns `{ ticket_id, link }` or `null`. This is the dedupe primitive an inbound integration uses before creating a new ticket.
- `listExternalSystems()` / `upsertTenantExternalSystem()` / `deleteTenantExternalSystem()` — settings; `ticket:update` for read, settings-level permission (same as checklist templates) for writes. Deleting a system in use is refused with a count.

Errors follow `ticketActionErrors.ts` (`isServerActionErrorResult` compatible) so the API controller can map them with `createServerActionErrorResponse`.

Comment linking is data + API in this scope; the manual UI only adds ticket-level links (see §5).

### 4. Events

Add to `packages/event-schemas/src/schemas/eventBusSchema.ts`:
`TICKET_EXTERNAL_LINK_ADDED`, `TICKET_EXTERNAL_LINK_UPDATED`, `TICKET_EXTERNAL_LINK_REMOVED` with payload `{ tenantId, ticketId, linkId, entityType, entityId, system, externalId, externalParentId, relationship, userId? }`. Also include `external_links` (ticket-level only) on the existing `TICKET_CREATED` payload when the create path received them, so a subscriber sees origin at creation without a second event.

Record an audit entry (`ticket_audit_logs`, source `'external_link'`) for add/remove so the activity timeline shows "Linked to GitHub #42".

### 5. MSP ticket UI

- **`TicketExternalLinksSection`** (`packages/tickets/src/components/ticket/`), mounted in `TicketDetails.tsx` beside `TicketCredentialsSection` and in `bento/TicketBentoLayout.tsx`. Lists ticket-level links as rows: system icon + label, `external_id` (`realm/external_id` when realm present), relationship chip, actor handle, link-out; kebab with Edit / Remove. Comment-level links are shown as a small system chip on the `CommentItem` (link-out only). Empty state: "No external links".
- **Add/Edit dialog** (standards §Dialog Component Usage): system select (built-ins + tenant customs, grouped), `external_id`, `realm` (label from the definition, shown when the definition declares one), `url` (required for systems without a template; otherwise optional override with live preview of the templated href), relationship (default `reference`; `origin` disabled with tooltip when one exists), actor handle/display (collapsed "Who acted there" group).
- **Origin badge**: extend `getTicketOrigin` input with `origin_link_system?: string | null`; when set, map through the definition's `originCategory`; the badge tooltip appends the system label. `TicketDetails.originBadge.contract.test.ts` and `ticketOrigin` tests gain cases.
- Load links in `packages/tickets/src/lib/ticketScreenBootstrap.ts` alongside `checklistItems` so first paint includes them.
- Client portal: links are **not** rendered (`packages/client-portal/.../TicketDetails.tsx` untouched; the portal actions never select them).
- i18n: new keys under `features/tickets` (`externalLinks.*`) and `msp/settings` (`externalSystems.*`), en/de/nl per standards §Internationalization.

### 6. REST API

Routes under `server/src/app/api/v1/tickets/[id]/external-links/` wired through `ApiTicketController` exactly like checklist (`getChecklist`/`createChecklistItem` at `ApiTicketController.ts:691`):

- `GET  /api/v1/tickets/{id}/external-links`
- `POST /api/v1/tickets/{id}/external-links` — body: `{ entity_type?: 'ticket'|'comment', comment_id?, system, external_id, external_parent_id?, realm?, url?, relationship?, actor?, external_status?, external_updated_at?, metadata? }`
- `PATCH /api/v1/tickets/{id}/external-links/{linkId}`
- `DELETE /api/v1/tickets/{id}/external-links/{linkId}`
- `GET  /api/v1/tickets/by-external-link?system=…&external_id=…&external_parent_id=…` — 200 with ticket summary + link, 404 otherwise.
- `POST /api/v1/tickets` and `POST /api/v1/tickets/{id}/comments` accept an optional `external_links: [...]` array (ticket-level links on create; a comment-level link on comment create). Links are written in the same transaction as the entity so a bot's create is atomic.
- `GET /api/v1/tickets` gains filters `external_system` and `external_id`.

Zod schemas in `server/src/lib/api/schemas/ticket.ts`; OpenAPI entries in `server/src/lib/api/openapi/routes/workManagementV1.ts` (add `/external-links` and `/by-external-link` to the collection-path suffix lists at lines ~374/398); regenerate `server/src/lib/mcp/registry.generated.ts` via `ee/scripts/generate-chat-registry.mjs`; document in `ee/docs/api-registry/tickets.json`.

Settings for custom systems are UI-only in this scope (no `/external-systems` API).

## Implementation sequence

1. Migration for `tenant_external_systems` and `external_entity_links`; `tenantTableMetadata` entries; `ITicket`/`IComment` type additions (`external_links?: IExternalEntityLink[]`); built-in catalog and resolver in `@alga-psa/types` / `packages/tickets/src/lib/externalSystems.ts`.
2. Event schema additions and audit-log source.
3. Actions package (`externalLinks/`) with validation, errors, events, audit; `findTicketByExternalLink`.
4. Origin resolver extension and bootstrap loading.
5. REST API: schemas, controller methods, routes, list filters, create-with-links on tickets and comments, OpenAPI + registry regeneration + api-registry docs.
6. MSP UI: section, dialog, comment chip, origin badge tooltip; i18n en/de/nl.
7. Settings tab for tenant custom systems.

## Testing

- **Unit** (`packages/tickets/src/lib/__tests__/`): catalog key validity; `renderExternalLinkUrl` templating and explicit-url precedence; custom-key namespace rule; `getTicketOrigin` with `origin_link_system`.
- **Action/integration** (skill: `integration-testing`): add/update/remove round trip; single-origin enforcement returns `origin_exists`; duplicate external record returns `duplicate_external_link`; comment link on a foreign ticket rejected; `findTicketByExternalLink` hit/miss including `external_parent_id`; deleting an in-use custom system refused; cascade on ticket delete.
- **API contract** (`server/src/test/unit/api/`, modeled on `ticketChecklists.contract.test.ts`): all five routes, create-with-links atomicity (link failure rolls back ticket), list filters, permission gating (`read` vs `update`).
- **UI contract tests** (existing pattern in `packages/tickets/src/components/ticket/*.contract.test.ts`): section mounted in both layouts; dialog disables `origin` when one exists; client portal source contains no `external_links` reference.
- **Facade contract**: `externalLinks` actions use `tenantDb` and never root-query `external_entity_links` (mirror `ticketBundleFacade.contract.test.ts`).

## Out of scope / follow-ups

- Outbound delivery to Discord/GitHub/etc. (subscribers of the new events).
- Migrating `email_metadata` into `external_entity_links` (`system='email'`).
- A public API for managing tenant custom systems.
- Per-system capability flags or credentials — those belong to integration config.
- Reply-via-channel affordance in the comment composer.
