# PRD — Preserve optional ticket fields on create

- Slug: `ticket-create-field-persistence`
- Date: 2026-09-19
- Status: Draft for design review
- Source: card “POST /api/v1/tickets silently drops url, severity_id, urgency_id and impact_id on create”; reported reproduction on ticket alga-2026-0002512.

## Problem and user value

A caller can supply a ticket URL and receive a successful creation response with the URL missing. The shared creation input also declares severity, urgency, and impact references that the insert path does not persist. API integrations cannot trust a successful create to retain these values and may need a follow-up update.

The dossier reports POST returning HTTP 201 with `url: null`, followed by a successful PUT of the same URL. Source inspection confirms three gaps in this checkout:

1. `server/src/lib/api/schemas/ticket.ts` accepts `url` on create but does not accept `severity_id`, `urgency_id`, or `impact_id`.
2. `server/src/lib/api/services/TicketService.ts` forwards `url` to the shared model but omits the three IDs.
3. `shared/models/ticketModel.ts` declares all four in `CreateTicketInput`, omits them from `ticketData`, and omits the three IDs from `ticketSchema`. The parsed result of `ticketSchema.partial()` becomes the inserted row, so unknown schema keys would still disappear after a row-mapping-only fix.

## Goals

- Persist every supplied value among these four fields through both REST creation and direct shared-model creation.
- Preserve optional-field behavior for existing callers.
- Make handling of shared creation input fields explicit and checked by TypeScript so future additions cannot silently bypass the persistence decision.
- Prove persistence with actual migrated database queries and API round trips.

## Non-goals

- New classification administration screens, CSV import columns, or client-portal form fields.
- Changes to numeric `itil_impact` / `itil_urgency` or priority calculation. These are distinct from the UUID reference fields.
- Broader ticket update semantics, unknown-key policy changes across the API, or a generic ORM/mapping framework.
- Backfill, feature flags, new telemetry, or unrelated ticket lifecycle fixes.

## Users and primary flows

- An integration creates a ticket with a URL and same-tenant classification references. HTTP 201 returns those values, and GET of the new ticket returns the same values without a compensating PUT.
- A caller of `TicketModel.createTicket` or `createTicketWithRetry` supplies these fields and gets a row retaining them.
- An existing caller omits them and creates a ticket successfully with nullable values unset.
- Invalid UUID syntax is rejected at the API boundary. An invalid or foreign-tenant reference cannot leave a created ticket behind.

## UX / UI notes

This is a data-persistence and API-contract correction. No layout changes are required. The API's current response envelope and success status remain in use. API documentation must describe the four optional fields and distinguish UUID references from numeric ITIL inputs.

## Requirements

### R1 — Shared persistence and field handling

Create a local, explicit field-handling declaration covering `keyof CreateTicketInput`. Prefer a typed mapping whose entries account for each input as a direct row column, a transformation, or an intentional non-persisted field with a reason. Use this declaration in row construction; a detached list that can drift from the insert is insufficient. Adding an input key must require an explicit handling decision at compile time.

Persist `url`, `severity_id`, `urgency_id`, and `impact_id` from cleaned input. Keep server-generated tenant, ID, number, and timestamps under model control. Preserve the contact alias, description-to-attributes transformation, JSON serialization, billing-profile resolution, default status, and existing ITIL behavior. Record existing intentional exclusions without changing their behavior in this fix. Do not spread arbitrary request input into the insert.

Extend the shared row validation schema to retain nullable UUID classification columns. Make the create-specific mapped row complete for these four fields before parsing; do not rely on `.partial()` to detect missing values. Omitted values become null on the row. Preserve the existing empty-string cleaning for other nullable fields; do not infer that the four affected fields currently have this normalization. Supplied classification references must be valid UUIDs.

### R2 — REST contract and forwarding

Accept each classification ID as an optional UUID in the create request and forward it through `TicketService` to the shared model. Keep `url`'s existing optional URL validation. Omitted values are allowed; explicit null and empty strings do not become newly accepted REST inputs in this work.

Expose all four fields in the ticket response contract, using nullable UUIDs for stored classification references, and align relevant ticket types. Document them in `server/src/lib/api/openapi/routes/workManagementV1.ts`'s separately declared create body. Inspect any other active ticket-create documentation before editing; avoid unrelated schema cleanup.

`updateTicketSchema` derives from the create schema, and the shared update schema derives from the row schema. Separate or explicitly omit the added create-only fields where necessary to preserve existing update request acceptance. Existing URL updates must continue to work.

### R3 — Integrity and compatibility

Use the existing nullable columns and tenant-qualified foreign keys to `severities`, `urgencies`, and `impacts`. Preserve transaction boundaries and tenant-scoped access. Malformed UUID input returns the established API validation response; nonexistent and cross-tenant references must fail and roll back rather than returning a successful create. Reuse established error translation where applicable.

Keep existing required fields, status-to-board validation, numbering, assignments, tags, external links, description storage, billing defaults, and event timing intact. A direct shared-model test establishes the fix below REST; additional UI or import field plumbing is outside scope.

### R4 — Regression coverage

Use a small representative set: schema validation, a shared-model database persistence test, a database integrity guard, and REST POST/GET coverage. Include omission behavior and a mapping/transformation compatibility case. Assertions must inspect persisted columns rather than only mocked insert arguments or source strings. Run relevant existing board/status and ticket-create suites as regression checks.

## Data / API / integration notes

- The initial migration `server/migrations/202409071803_initial_schema.cjs` declares the nullable classification columns and composite tenant foreign keys. Confirm they exist in the migrated test schema; no product migration is expected.
- The shared create path serves API, server action, inbound, import, and portal callers. A caller benefits when it actually passes these inputs.
- The current CSV import `createInput` does not pass any of the four fields. The dossier's suspicion of import data loss is not established by this checkout and is not an acceptance claim.
- The API create controller validates the request and returns the service result. The service reloads the inserted ticket, making the database row the response source.

## Risks and rollout

- A mapping refactor can accidentally change defaults or transformed fields; keep it local and validate representative transformations.
- The schema parse is itself a drop point. Cover the persisted result after parsing, not only the field map.
- Newly honored IDs can cause previously ignored invalid references to fail. This is required data-integrity behavior; document valid same-tenant UUID requirements.
- Existing null values do not reveal their lost original values. No automatic recovery/backfill is possible from the ticket row alone.
- Deliver through the normal application release. No migration or feature flag is planned. Deployment and workflow advancement remain separate assignments.

## Open questions and assumptions

- No unanswered product decision blocks this draft: use existing URL syntax rules, optional UUID request fields, and nullable storage.
- Implementation must verify current migration constraints and the established error response for foreign-key failures; preserve that convention while proving rollback.
- All checklist entries remain unimplemented until later implementation work. This planning assignment does not approve or advance the board step.

## Acceptance criteria

1. POST with all four valid optional values returns 201 with exact values; GET and a direct database read agree.
2. Shared-model creation with the four values persists them independently of REST.
3. Omitting the four fields still succeeds and stores nulls; existing cleaning for other nullable fields remains compatible.
4. Malformed UUIDs fail validation; nonexistent or foreign-tenant classification references fail without a persisted ticket.
5. Create-input additions require an explicit mapping/handling decision in TypeScript, and unknown request fields cannot overwrite generated row values.
6. Representative defaults, aliases, attributes, and existing URL update behavior remain correct; relevant existing regressions pass.
7. Request, response, and OpenAPI declarations accurately represent the four fields without unintentionally broadening update behavior.
