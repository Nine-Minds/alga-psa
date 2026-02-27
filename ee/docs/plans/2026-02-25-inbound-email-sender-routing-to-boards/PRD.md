# PRD — Inbound Email Sender Routing to Boards

- Slug: `inbound-email-sender-routing-to-boards`
- Date: `2026-02-25`
- Status: Draft

## Summary

Revise routing ownership to live on clients and contacts instead of provider-level sender-rule tables.

The system should resolve an effective inbound destination from:
- contact override (exact sender match),
- then client default destination (exact contact client or domain-matched client),
- then provider default inbound settings.

Destination should resolve to an Inbound Ticket Defaults profile (not just `board_id`) so board/status/priority/category/client/location remain coherent.

## Problem

Today, new inbound-email tickets always use one provider-level defaults profile and one board.

Current sender matching logic only influences `client_id`/`contact_id`:
- exact contact email match,
- explicit client domain mapping (`client_inbound_email_domains`).

Because board/defaults are not resolved from client/contact ownership, tickets from known client domains still land on a generic board and require manual rerouting.

## Goals

1. Let each client define a default inbound destination profile.
2. Let each contact optionally define a destination override that takes precedence over client default.
3. Reuse existing client domain mapping so unknown contacts from a known client domain route to that client's destination.
4. Preserve deterministic precedence and safe fallback to provider defaults.
5. Keep existing reply-thread behavior unchanged.

## Non-goals

1. Provider-level sender-rule table UI in this phase.
2. Wildcard/regex sender matching.
3. Routing existing ticket replies to other boards.
4. Auto-provisioning client/contact routing from historical mail.

## Users and Primary Flows

### Personas
- Admin/dispatcher configuring client and contact behavior.
- Helpdesk operators expecting inbound tickets to land on the correct board.

### Flow A — Exact contact with contact override
1. New email arrives from `invoices@customer.com`.
2. Sender matches a contact by exact email.
3. Contact has `inbound_ticket_defaults_id` override.
4. Ticket uses contact override defaults profile.

### Flow B — Exact contact without override
1. New email arrives from `tech@customer.com`.
2. Sender matches a contact by exact email.
3. Contact has no override; contact's client has default destination.
4. Ticket uses client default destination profile.

### Flow C — Domain-matched client (unknown contact)
1. New email sender is not an exact contact.
2. Domain matches explicit `client_inbound_email_domains` record.
3. Matched client has default destination.
4. Ticket uses client default destination profile.

### Flow D — No contact/domain client routing match
1. New email arrives from unconfigured sender/domain.
2. Ticket uses provider default inbound settings.

### Flow E — Existing ticket reply
1. Email is matched by reply token/thread headers.
2. System appends comment to existing ticket.
3. No client/contact routing for board/defaults is evaluated.

## UX / UI Notes

### Client screen (`ClientDetails`)
- Keep existing Inbound email domains management.
- Add Inbound ticket destination picker for Inbound Ticket Defaults.
- Helper text: "Used for inbound senders that map to this client and have no contact override."

### Contact screen
- Add optional Inbound ticket destination override picker.
- Helper text: "If set, this overrides the client destination for this exact sender contact."

### Resolution help text
- Display precedence in both screens:
  - Contact override -> Client destination -> Provider default.

## Requirements

### Functional Requirements

1. Add client-level inbound destination setting:
   - `clients.inbound_ticket_defaults_id` (nullable UUID), or equivalent persisted client property.
2. Add contact-level destination override:
   - `contacts.inbound_ticket_defaults_id` (nullable UUID), or equivalent persisted contact property.
3. Resolution for new-ticket creation must use this precedence:
   - exact contact sender + contact override,
   - else exact contact sender + contact's client destination,
   - else domain-matched client destination,
   - else provider default inbound settings.
4. Existing ticket reply/comment paths remain unchanged and do not re-evaluate destination.
5. Existing exact-contact and domain-to-client matching behavior remains intact.
6. Validate resolved destination belongs to tenant and is active; otherwise fallback to provider default.
7. Add server actions/API updates to read/write client/contact destination settings with existing permissions.
8. Update client and contact UI surfaces to set/clear these values.
9. When no client/contact destination is configured, behavior remains identical to current provider-default flow.

### Non-functional Requirements

1. No degradation of inbound processing throughput.
2. No cross-tenant routing leakage.
3. No dedupe/idempotency regression.

## Data / API / Integrations

### Approach Options
1. Provider-level sender rule table (previous draft).
2. Client/contact-owned destination config (recommended).
3. Board-only fields on client/contact.

Recommendation rationale:
- Client and contact screens are the natural ownership point.
- Existing domain mapping already maps senders to client identity.
- Using inbound defaults profile IDs avoids board-only mismatches.

### Proposed Data Model
- Reuse: `client_inbound_email_domains` (already present).
- Add:
  - `clients.inbound_ticket_defaults_id` nullable.
  - `contacts.inbound_ticket_defaults_id` nullable.
- Add indexes for read path:
  - `(tenant, inbound_ticket_defaults_id)` on clients.
  - `(tenant, inbound_ticket_defaults_id)` on contacts.

### Resolution Integration Points
- `shared/services/email/processInboundEmailInApp.ts`
  - resolve effective defaults before ticket creation.
- `shared/workflow/runtime/actions/registerEmailWorkflowActions.ts`
  - extend `resolve_inbound_ticket_context` to return effective defaults using same precedence.
- `shared/workflow/actions/emailWorkflowActions.ts`
  - add shared resolver helper(s) used by both paths.
- UI/actions:
  - `packages/clients/src/components/clients/ClientDetails.tsx`
  - contact edit/create surfaces in `packages/clients/src/components/contacts/*`
  - related actions in `packages/clients/src/actions/*`

## Security / Permissions

1. Client destination updates require existing client update permission.
2. Contact override updates require existing contact update permission.
3. Resolver validates destination defaults are in the same tenant.

## Observability

1. Add structured debug logs for destination resolution source:
   - `contact_override`, `client_default_from_contact`, `client_default_from_domain`, `provider_default`.
2. Warn when configured client/contact destination is invalid or inactive and fallback is applied.

## Rollout / Migration

1. Add migration(s) for client/contact destination fields (or equivalent persisted schema).
2. No backfill required.
3. Tenants without new config continue on provider defaults unchanged.

## Open Questions

1. Should client/contact destination be global, or optionally provider-specific when a tenant has multiple inbound mailboxes?
2. Should we block saving client/contact destination when target defaults are inactive, or allow and fallback at runtime?
3. Should contact override be shown only for contacts with valid email addresses?

## Acceptance Criteria (Definition of Done)

1. Exact-sender contact with contact override creates new ticket using contact destination defaults.
2. Exact-sender contact without override uses client destination defaults.
3. Unknown sender with domain-matched client uses client destination defaults.
4. Unmatched sender uses provider default inbound settings.
5. Existing-ticket reply flows are unchanged.
6. In-app inbound and workflow-runtime paths produce identical destination resolution for the same sender/provider input.
