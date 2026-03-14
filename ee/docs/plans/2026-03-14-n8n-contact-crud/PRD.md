# PRD — N8n Contact CRUD Node Expansion

- Slug: `n8n-contact-crud`
- Date: `2026-03-14`
- Status: Draft

## Summary
Expand the `Alga PSA` n8n community node so automation builders can work with contacts directly, not just tickets and lookup resources. The first pass adds a first-class `Contact` resource with `Create`, `Get`, `List`, `Update`, and `Delete` operations, and matches the current ticket node’s ergonomics for field grouping, validation, normalized output, and continue-on-fail behavior.

## Problem
The current `n8n-nodes-alga-psa` package exposes ticket CRUD plus helper lookup resources, but it does not expose contact CRUD. Teams building Alga PSA automations in n8n cannot create or maintain contacts without falling back to generic HTTP nodes, hand-rolled request payloads, and manual error handling.

That gap creates three problems:
- Contact workflows are inconsistent with ticket workflows in the same package.
- Users lose the package’s built-in lookup, validation, and output normalization behavior.
- Common automations such as “create contact from form submission” or “update a contact before creating a ticket” require lower-level API wiring than they should.

## Goals
1. Add `Contact` as a first-class resource in the `Alga PSA` n8n node.
2. Support contact `Create`, `Get`, `List`, `Update`, and `Delete`.
3. Mirror the ticket node’s editor conventions: separate required and optional fields, manual UUID fallback for lookups, normalized success output, and continue-on-fail support.
4. Limit the first pass to core contact fields already supported by the current API contract.
5. Update examples, README, release notes, and package tests so the feature is complete and publishable.

## Non-goals
- No `Contact -> Search` operation in this pass.
- No attempt to expose the full contact schema on day one.
- No backend API changes unless implementation discovers an actual API gap.
- No full resource-registry rewrite for the n8n package.
- No new credential model or authentication behavior.

## Users and Primary Flows
- n8n workflow builder:
  - Selects `Contact` as the resource.
  - Creates a contact from upstream automation data.
  - Lists contacts with filters for downstream branching or enrichment.
  - Fetches, updates, or deletes a contact by ID.

- Existing Alga PSA node user:
  - Expects contact operations to feel like ticket operations.
  - Reuses `Client` lookup behavior when setting `client_id`.
  - Expects list responses and error objects to follow the package’s current conventions.

## UX / UI Notes
- Add `Contact` to the resource selector beside `Ticket`, `Client`, `Board`, `Status`, and `Priority`.
- When `Contact` is selected, show a dedicated `contactOperation` selector.
- Use ticket-style field organization:
  - required top-level fields for `Create`
  - optional “additional fields” collections for `Create` and `Update`
  - dedicated ID field for `Get`, `Update`, and `Delete`
  - dedicated pagination/filter fields for `List`
- `client_id` should use the same `resourceLocator` pattern as ticket references:
  - `From List`
  - `By ID`
- `phone_numbers` should be authored as JSON in the first pass rather than as a nested collection UI.
- Do not expose a contact search operation in the first pass.

## Requirements

### Functional Requirements
- FR-01: The node resource selector includes `Contact`.
- FR-02: The node exposes `Contact` operations: `Create`, `Get`, `List`, `Update`, and `Delete`.
- FR-03: `Contact -> Create` requires `full_name`.
- FR-04: `Contact -> Create` supports optional `email`, `client_id`, `role`, `notes`, `is_inactive`, and `phone_numbers`.
- FR-05: `Contact -> Update` supports optional `full_name`, `email`, `client_id`, `role`, `notes`, `is_inactive`, and `phone_numbers`.
- FR-06: `client_id` input for contact create/update supports both lookup mode and manual UUID mode.
- FR-07: `Contact -> Get`, `Update`, and `Delete` validate `contactId` before making a request.
- FR-08: `Contact -> List` supports pagination and core filters needed for practical automation: `page`, `limit`, `client_id`, `search_term`, and `is_inactive`.
- FR-09: Contact create requests send `POST /api/v1/contacts` with a compact payload that omits empty values.
- FR-10: Contact get requests send `GET /api/v1/contacts/{id}`.
- FR-11: Contact list requests send `GET /api/v1/contacts` and preserve pagination metadata in node output.
- FR-12: Contact update requests send `PUT /api/v1/contacts/{id}` with only provided fields.
- FR-13: Contact delete requests send `DELETE /api/v1/contacts/{id}` and return a non-empty normalized success object.
- FR-14: Contact operations use the package’s existing API response normalization so wrapped `{ data: ... }` contact responses are unwrapped for downstream nodes.
- FR-15: Continue-on-fail behavior works for contact operations with the same item-level error shape already used by ticket operations.
- FR-16: `phone_numbers` input is validated before request dispatch and must match the API’s expected array-of-objects shape.
- FR-17: The README operation matrix and examples include contact support.
- FR-18: Release notes mention the contact CRUD expansion.

### Non-functional Requirements
- NFR-01: Existing ticket, client, board, status, and priority behaviors remain unchanged.
- NFR-02: Contact support follows the package’s current TypeScript, Vitest, and helper conventions rather than introducing a second style.
- NFR-03: Validation failures for contact IDs or `phone_numbers` occur before outbound HTTP requests are made.
- NFR-04: The first pass avoids gold-plating and stays limited to core CRUD plus documentation and test coverage.

## Data / API / Integrations
- Package scope:
  - `packages/n8n-nodes-alga-psa/nodes/AlgaPsa/AlgaPsa.node.ts`
  - `packages/n8n-nodes-alga-psa/nodes/AlgaPsa/helpers.ts`
  - `packages/n8n-nodes-alga-psa/nodes/AlgaPsa/transport.ts`
  - `packages/n8n-nodes-alga-psa/__tests__/*`
  - `packages/n8n-nodes-alga-psa/README.md`
  - `packages/n8n-nodes-alga-psa/RELEASE_NOTES.md`
  - `packages/n8n-nodes-alga-psa/examples/*`

- Existing API endpoints:
  - `POST /api/v1/contacts`
  - `GET /api/v1/contacts`
  - `GET /api/v1/contacts/{id}`
  - `PUT /api/v1/contacts/{id}`
  - `DELETE /api/v1/contacts/{id}`

- Relevant server contracts:
  - `server/src/lib/api/schemas/contact.ts`
  - `server/src/lib/api/controllers/ApiContactController.ts`

- Contact payload scope for the first pass:
  - `full_name`
  - `email`
  - `client_id`
  - `role`
  - `notes`
  - `is_inactive`
  - `phone_numbers`

- `phone_numbers` API shape:
  - array of objects
  - each entry requires `phone_number`
  - optional keys include `contact_phone_number_id`, `canonical_type`, `custom_type`, `is_default`, and `display_order`

## Security / Permissions
- The node continues using the existing `Alga PSA API` credential with `x-api-key`.
- No permission model changes are required in the node package.
- Client and contact UUID fields must be validated before request dispatch.
- `phone_numbers` JSON must be validated before dispatch to prevent opaque API failures caused by malformed local input.

## Observability
- No new telemetry or logging work is planned in this pass.
- Existing request tests, helper tests, and documentation tests are the primary quality controls for this package-level change.

## Rollout / Migration
- No migration is required because this is a package surface expansion.
- Existing installed workflows remain unchanged.
- Contact support should ship as a package release with updated docs and example workflows.

## Open Questions
1. Should the first-pass list UI expose only the agreed core filters, or should it also expose additional contact API filters such as `full_name`, `email`, `phone_number`, `role`, `has_client`, and `client_name`?
2. Should the first example workflow focus on create-only, or demonstrate a chained CRUD flow such as create then update?

## Acceptance Criteria (Definition of Done)
1. The `Alga PSA` node exposes `Contact` with `Create`, `Get`, `List`, `Update`, and `Delete`.
2. Contact create and update support the agreed core fields and validate IDs plus `phone_numbers` locally.
3. Contact list preserves pagination metadata and supports core filters required for practical automation use.
4. Contact operations return normalized outputs and item-level continue-on-fail errors consistent with existing ticket behavior.
5. Automated tests cover node description, request construction, validation failures, list behavior, delete normalization, and docs synchronization.
6. README, release notes, and at least one example workflow reflect the new contact support.
