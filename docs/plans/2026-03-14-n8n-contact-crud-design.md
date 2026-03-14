# N8n Contact CRUD Design

- Date: `2026-03-14`
- Status: `Approved`
- Scope: `packages/n8n-nodes-alga-psa`

## Summary

Expand the `Alga PSA` n8n community node to support a first-class `Contact` resource with ticket-style ergonomics. The first pass should add contact `Create`, `Get`, `List`, `Update`, and `Delete` operations, align the editor experience with the existing ticket resource, and keep scope limited to core contact fields already exercised by the API and product UI.

This is an n8n package expansion, not a backend API invention. The server already exposes `GET/POST /api/v1/contacts` and `GET/PUT/DELETE /api/v1/contacts/{id}`.

## Goals

- Add `Contact` as a first-class n8n node resource.
- Support contact CRUD with the same operational feel as ticket CRUD.
- Reuse existing node conventions for validation, success normalization, and continue-on-fail behavior.
- Keep first-pass field coverage focused on core contact fields.
- Update package docs, examples, and tests so the new surface is shippable.

## Non-goals

- No contact `Search` operation in the first pass.
- No attempt to expose the full contact schema on day one.
- No backend API changes unless gaps are discovered during implementation.
- No generic registry rewrite for all n8n resources in this pass.

## Approaches Considered

### Recommended: Add contact support with a small internal refactor

- Extend the current node with a `Contact` resource and contact-specific CRUD operations.
- Extract or add shared helper logic where needed so ticket and contact behavior follow the same internal shape.

Why this approach:
- Keeps the public node surface simple.
- Avoids overloading the already-large node file with ad hoc one-off contact logic.
- Delivers contact parity without taking on a full framework rewrite.

### Alternative: Minimal inline extension in the existing node file

- Add contact fields and execute branches directly into the current resource switch with minimal cleanup.

Why not recommended:
- Fastest to start, but increases maintenance cost in an already dense file.
- Makes future additions like contact search or more resources harder to reason about.

### Alternative: Full resource-registry abstraction

- Convert ticket, contact, and helper resources into a generic registry-driven architecture.

Why not recommended:
- Too much surface area for a first contact pass.
- Raises regression risk for existing ticket behavior.
- Slows delivery of the actual user-facing capability.

## User Experience

`Contact` should appear beside `Ticket`, `Client`, `Board`, `Status`, and `Priority` in the node resource selector.

When `Contact` is selected:
- The node should expose a dedicated `contactOperation` selector.
- Required create fields should be separated from optional additional fields, mirroring ticket create/update behavior.
- `client_id` should use the same lookup-plus-manual-ID pattern already used by ticket references.
- List output should preserve pagination metadata.
- Success and error handling should match current ticket behavior, including continue-on-fail item wrapping.

## Contact Scope

### Operations

- `Create`
- `Get`
- `List`
- `Update`
- `Delete`

### Fields

Create required fields:
- `full_name`

Create and update optional fields:
- `email`
- `client_id`
- `role`
- `notes`
- `is_inactive`
- `phone_numbers`

### Field Shape Notes

- `client_id` should be a `resourceLocator` with client lookup support and manual UUID fallback.
- `phone_numbers` should be exposed as a JSON-authored field in the first pass rather than a complex nested n8n collection UI.
- `List` should support practical filters that align with the API and current lookup usage:
  - `page`
  - `limit`
  - `client_id`
  - `search_term`
  - `is_inactive` if the API behavior is confirmed during implementation

## Architecture

### Node Description

Update [packages/n8n-nodes-alga-psa/nodes/AlgaPsa/AlgaPsa.node.ts](/Users/roberisaacs/alga-psa.worktrees/feature/n8n-contact-crud/packages/n8n-nodes-alga-psa/nodes/AlgaPsa/AlgaPsa.node.ts) to:
- add `contact` to the resource options
- add `contactOperation`
- define contact CRUD fields and additional-field collections
- reuse existing client lookup load options for `client_id`
- update the node subtitle so contact operations render cleanly

### Payload and Query Helpers

Update [packages/n8n-nodes-alga-psa/nodes/AlgaPsa/helpers.ts](/Users/roberisaacs/alga-psa.worktrees/feature/n8n-contact-crud/packages/n8n-nodes-alga-psa/nodes/AlgaPsa/helpers.ts) to add:
- contact create payload builder
- contact update payload builder
- contact list query builder
- `phone_numbers` parsing and validation helpers

The helper shape should stay close to the ticket helper conventions:
- strip empty values
- validate required strings and UUIDs before sending requests
- normalize JSON-authored fields into the API payload shape

### Execute Flow

Extend the execute logic in [packages/n8n-nodes-alga-psa/nodes/AlgaPsa/AlgaPsa.node.ts](/Users/roberisaacs/alga-psa.worktrees/feature/n8n-contact-crud/packages/n8n-nodes-alga-psa/nodes/AlgaPsa/AlgaPsa.node.ts) to route:
- `POST /api/v1/contacts`
- `GET /api/v1/contacts/{id}`
- `GET /api/v1/contacts`
- `PUT /api/v1/contacts/{id}`
- `DELETE /api/v1/contacts/{id}`

Use the same output conventions already established for tickets:
- unwrap `{ data: ... }` objects
- preserve paginated list metadata
- return non-empty normalized delete success objects
- convert API errors into the current n8n error shape

## Testing

Update the existing node tests rather than introducing a new testing style.

### Description and Load Option Tests

Extend [packages/n8n-nodes-alga-psa/__tests__/node-description-loadoptions.test.ts](/Users/roberisaacs/alga-psa.worktrees/feature/n8n-contact-crud/packages/n8n-nodes-alga-psa/__tests__/node-description-loadoptions.test.ts) to cover:
- `Contact` appearing in the resource selector
- valid contact operation options
- client lookup reuse in contact fields
- separation of required create fields from optional update/create collections

### Execute Tests

Extend [packages/n8n-nodes-alga-psa/__tests__/node-execute.test.ts](/Users/roberisaacs/alga-psa.worktrees/feature/n8n-contact-crud/packages/n8n-nodes-alga-psa/__tests__/node-execute.test.ts) to cover:
- create request payload mapping
- get by ID
- list query serialization and pagination output
- update payload mapping
- delete request shape and normalized success output
- continue-on-fail behavior for contact operations

### Helper Tests

Extend [packages/n8n-nodes-alga-psa/__tests__/helpers.test.ts](/Users/roberisaacs/alga-psa.worktrees/feature/n8n-contact-crud/packages/n8n-nodes-alga-psa/__tests__/helpers.test.ts) for:
- `phone_numbers` parsing
- malformed JSON handling
- compact payload/query behavior for contact fields

### Documentation Tests

Extend [packages/n8n-nodes-alga-psa/__tests__/docs.test.ts](/Users/roberisaacs/alga-psa.worktrees/feature/n8n-contact-crud/packages/n8n-nodes-alga-psa/__tests__/docs.test.ts) so README examples and operation matrix stay in sync.

## General Plan

1. Extend the public node surface.
   Add `Contact` to the resource matrix, define contact CRUD operations, and expose ticket-style contact fields in the node description.

2. Add contact helper builders and validation.
   Introduce contact payload/query helpers and validate JSON-authored `phone_numbers` before requests are sent.

3. Implement execute paths.
   Wire the contact operations to the existing `/api/v1/contacts` endpoints using the same normalization and error-handling conventions as tickets.

4. Expand package tests.
   Cover node description, request shapes, list behavior, validation failures, delete normalization, and continue-on-fail behavior.

5. Update package documentation and examples.
   Refresh the README operation matrix and add at least one contact example workflow plus a release-note entry.

## Risks and Open Questions

- `phone_numbers` is the main shape risk because the API expects structured entries; the first pass should validate this aggressively and keep the authoring model simple.
- The exact `List` filter set should be finalized against current contact API behavior during implementation, especially `is_inactive`.
- If contact-specific label fields or response shapes differ from expectations, the node should follow actual API responses rather than forcing ticket-style naming.
