# PRD — Inbound Email Domain Matching + Client Default Contact

- Slug: `inbound-email-domain-matching-default-contact`
- Date: `2026-02-13`
- Status: Draft

## Summary

When processing inbound emails that create **new tickets**, we currently resolve the ticket `client_id` and `contact_id` only via an exact contact email match (and otherwise fall back to inbound ticket defaults). We want to add an explicit, admin-configured mapping from inbound sender email domains to clients, plus an optional per-client default contact.

Key change from the earlier approach: domain matching must be **explicitly configured** per client and **unique** across clients; we must not infer domain ownership by scanning existing contacts.

## Problem

Inbound email senders are frequently new people at an existing customer. Exact email matching fails, and the system falls back to the inbound ticket defaults’ configured client, causing misfiled tickets and manual triage.

## Goals

1. New ticket creation from inbound email can resolve `targetClientId` by sender email domain **only when** the domain is explicitly configured for a client.
2. A configured inbound email domain must be **unique per tenant** (cannot be assigned to multiple clients).
3. Each client can configure a “Default contact” from its contacts list, and that contact is used as the ticket contact when domain-based client resolution is used.
4. Exact email match remains highest precedence for setting both contact and client.
5. If no configured domain match exists, behavior falls back to the existing defaults behavior.

## Non-goals

1. Creating new contacts automatically for unmatched senders.
2. Wildcard / suffix / subdomain pattern matching (e.g. `*.acme.com`) beyond the exact domain extracted from the sender email.
3. Inferring domain-to-client matches by scanning contacts’ email addresses.
4. Changing reply threading behavior or ticket reply matching behavior (reply-token/thread-header matching remains unchanged).

## Users and Primary Flows

### Personas
- **Helpdesk operator**: wants inbound tickets to land on the correct client with minimal manual corrections.
- **Admin / dispatcher**: configures client inbound email domains and default contact to make domain fallback useful.

### Flow A — Existing contact match (current behavior, preserved)
1. Inbound email arrives for processing (Google/Microsoft/IMAP pipelines feed into shared processing).
2. System normalizes sender email and finds a contact by exact email.
3. Ticket is created with `client_id = contact.client_id` and `contact_id = contact.contact_id`.

### Flow B — Domain fallback match (new)
1. Inbound email arrives and exact contact lookup returns none.
2. System extracts sender domain, and finds a client associated with that domain via an explicit inbound-email-domain mapping.
3. Ticket is created with `client_id = matched client`.
4. If that client has a configured default contact, ticket is created with `contact_id = default contact`.

### Flow C — No domain match configured (existing fallback)
1. Inbound email arrives and exact contact lookup returns none.
2. Domain lookup returns none.
3. Ticket falls back to inbound ticket defaults `client_id`; `contact_id` remains null.

## UX / UI Notes

### Client details: Inbound email domain configuration
- Add an “Inbound email domains” section on the client details screen.
- Admin can add/remove domain strings (e.g. `acme.com`).
- On add:
  - Validate the domain format.
  - Verify uniqueness in the tenant; if the domain is already assigned to another client, block the save and show which client owns it.
- Domains are used for inbound email domain matching only; if a client has no domains configured, the system will not domain-match to that client.

### Client details: Default contact configuration
- Add a “Default contact” picker on the client details screen.
- Picker options: contacts belonging to this client.
- Persist selection into `clients.properties.primary_contact_id` (and optionally `clients.properties.primary_contact_name` for display).
- Provide short helper text: “Used when inbound email sender is not a known contact but matches this client by email domain.”

## Requirements

### Functional Requirements

1. **Precedence rules**
   - If an exact contact match exists for sender email, use it (sets both client and contact).
   - Otherwise, attempt domain-to-client match using the explicit inbound email domain mapping.
   - If a configured domain-to-client match exists, set ticket `client_id` to the matched client.
   - If the matched client has a configured default contact, set ticket `contact_id` to that contact.
   - If no configured domain match exists, preserve existing fallback to inbound ticket defaults.

2. **Domain extraction**
   - Use normalized sender email (lowercased, display-name stripped).
   - Extract domain via substring after `@`.
   - Treat domain matching as case-insensitive.

3. **Explicit domain mapping**
   - Admin can configure 0..N inbound email domains per client.
   - A given domain may belong to at most one client per tenant (uniqueness enforced).
   - Domain matching in inbound processing consults only this explicit mapping (no inference from contacts).

4. **Default contact resolution**
   - Default contact is stored on the client as `clients.properties.primary_contact_id` (existing JSON field).
   - When applying it, validate the referenced contact exists, belongs to the client, and is active; otherwise treat as unset.

5. **Location behavior**
   - If inbound ticket defaults include `location_id`, and the resolved `targetClientId` differs from `ticketDefaults.client_id`, do not apply `location_id` (set null) to avoid cross-client location mismatch.

### Non-functional Requirements

1. Must not materially slow down inbound email processing for the common-case (exact contact match).
2. Failure to resolve domain match must not throw; should safely fall back to existing behavior.

## Data / API / Integrations

### Data model
- Reuse existing `clients.properties.primary_contact_id` (and `primary_contact_name`) for “default contact”. No migration required for this phase.
- Add a tenant-scoped mapping table for inbound email domains, with uniqueness by `(tenant, lower(domain))`.
  - Proposed: `client_inbound_email_domains` with columns: `tenant`, `id`, `client_id`, `domain`, `created_at`, `updated_at`.
  - Constraints/indexes:
    - Unique index on `(tenant, lower(domain))`.
    - Index on `(tenant, client_id)` for listing.

### Touch points (current code paths)
- Inbound email (in-app processing): `shared/services/email/processInboundEmailInApp.ts`
- Workflow runtime action used by email workflows: `shared/workflow/runtime/actions/registerEmailWorkflowActions.ts` (`resolve_inbound_ticket_context`)
- Contact lookup: `shared/workflow/actions/emailWorkflowActions.ts` (`findContactByEmail`)
- Client UI: `packages/clients/src/components/clients/ClientDetails.tsx`
- Client persistence: `packages/clients/src/actions/clientActions.ts` (`updateClient` merges `properties`)

## Security / Permissions

1. Updating default contact requires existing client update permission (already enforced by `updateClient`).
2. Managing inbound email domains requires existing client update permission (same UX surface as client configuration).
2. Inbound email processing runs server-side using admin DB access; ensure tenant scoping is always applied.

## Observability

Not in scope for this phase (follow existing logging patterns only).

## Rollout / Migration

1. Add migration for the inbound email domain mapping table + indexes.
2. Existing behavior remains unchanged for tenants/clients without configured inbound email domains (no domain matching will occur).

## Open Questions

1. Should we allow subdomain matching (e.g. `user@it.acme.com` matching configured `acme.com`) or require exact match only?
2. When domain match sets a default contact, should the created **comment author** be treated as a “contact” or remain “system”? (Today we can keep “system” unless there’s an exact sender contact match.)
3. Do we need a one-time helper to suggest/configure domains (e.g. admin UX that proposes domains based on contacts), or keep it fully manual?

## Acceptance Criteria (Definition of Done)

1. Inbound email new-ticket creation:
   - Exact contact match sets ticket client + contact as before.
   - If exact contact match fails and sender domain matches a configured inbound email domain, ticket `client_id` uses that client.
   - If the matched client has a valid default contact configured, ticket `contact_id` is set to it; otherwise it remains null.
   - If no inbound email domain is configured for the sender domain, ticket falls back to inbound defaults `client_id` and keeps `contact_id = null`.
2. Client screen:
   - Admin can add/remove inbound email domains for a client.
   - Adding a domain fails with a clear message if the domain is already assigned to another client (uniqueness enforced).
   - Admin can set/clear the client “Default contact” via a picker.
   - Selection persists and reloads correctly.
