# PRD — Inbound Email Domain Matching + Client Default Contact

- Slug: `inbound-email-domain-matching-default-contact`
- Date: `2026-02-13`
- Status: Draft

## Summary

When processing inbound emails that create **new tickets**, we currently resolve the ticket `client_id` and `contact_id` only via an exact contact email match (and otherwise fall back to inbound ticket defaults). We want to:

1. If no contact is found by email, attempt a **domain-based client match** (e.g. `user@acme.com` -> `acme.com`) to choose the ticket client.
2. Allow each client to configure a **default contact** to be associated when domain-matching is used.

## Problem

Inbound email senders are frequently new people at an existing customer. Exact email matching fails, and the system falls back to the inbound ticket defaults’ configured client, causing misfiled tickets and manual triage.

## Goals

1. New ticket creation from inbound email can resolve `targetClientId` by sender email domain when no exact contact match exists.
2. Each client can configure a “Default contact” from its contacts list, and that contact is used as the ticket contact when domain-based client resolution is used.
3. Exact email match remains highest precedence for setting both contact and client.
4. If domain matching is ambiguous or unavailable, behavior falls back to the existing defaults behavior.

## Non-goals

1. Creating new contacts automatically for unmatched senders.
2. Wildcard / suffix / subdomain pattern matching (e.g. `*.acme.com`) beyond the exact domain extracted from the sender email.
3. Introducing a new “client domains” management feature/table in this phase (domain matching is derived from existing contact emails).
4. Changing reply threading behavior or ticket reply matching behavior (reply-token/thread-header matching remains unchanged).

## Users and Primary Flows

### Personas
- **Helpdesk operator**: wants inbound tickets to land on the correct client with minimal manual corrections.
- **Admin / dispatcher**: configures client-level defaults (default contact) to make domain fallback useful.

### Flow A — Existing contact match (current behavior, preserved)
1. Inbound email arrives for processing (Google/Microsoft/IMAP pipelines feed into shared processing).
2. System normalizes sender email and finds a contact by exact email.
3. Ticket is created with `client_id = contact.client_id` and `contact_id = contact.contact_id`.

### Flow B — Domain fallback match (new)
1. Inbound email arrives and exact contact lookup returns none.
2. System extracts sender domain, finds a unique client associated with that domain (derived from existing contacts’ email domains).
3. Ticket is created with `client_id = matched client`.
4. If that client has a configured default contact, ticket is created with `contact_id = default contact`.

### Flow C — No/ambiguous domain match (existing fallback)
1. Inbound email arrives and exact contact lookup returns none.
2. Domain lookup returns none or multiple possible clients.
3. Ticket falls back to inbound ticket defaults `client_id`; `contact_id` remains null.

## UX / UI Notes

### Client details: Default contact configuration
- Add a “Default contact” picker on the client details screen.
- Picker options: contacts belonging to this client.
- Persist selection into `clients.properties.primary_contact_id` (and optionally `clients.properties.primary_contact_name` for display).
- Provide short helper text: “Used when inbound email sender is not a known contact but matches this client by email domain.”

## Requirements

### Functional Requirements

1. **Precedence rules**
   - If an exact contact match exists for sender email, use it (sets both client and contact).
   - Otherwise, attempt domain-to-client match.
   - If domain-to-client match succeeds, set ticket `client_id` to the matched client.
   - If the matched client has a configured default contact, set ticket `contact_id` to that contact.
   - If domain match fails or is ambiguous, preserve existing fallback to inbound ticket defaults.

2. **Domain extraction**
   - Use normalized sender email (lowercased, display-name stripped).
   - Extract domain via substring after `@`.
   - Treat domain matching as case-insensitive.

3. **Domain-to-client resolution (minimal, derived)**
   - Derive candidate clients by scanning contacts where `email` domain matches.
   - Only accept a match when exactly one unique `client_id` is found for that domain (in the tenant).
   - Ignore inactive contacts for the purposes of domain-to-client resolution.

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
- Domain matching is derived from `contacts.email` values (no new “client domains” table in this phase).

### Touch points (current code paths)
- Inbound email (in-app processing): `shared/services/email/processInboundEmailInApp.ts`
- Workflow runtime action used by email workflows: `shared/workflow/runtime/actions/registerEmailWorkflowActions.ts` (`resolve_inbound_ticket_context`)
- Contact lookup: `shared/workflow/actions/emailWorkflowActions.ts` (`findContactByEmail`)
- Client UI: `packages/clients/src/components/clients/ClientDetails.tsx`
- Client persistence: `packages/clients/src/actions/clientActions.ts` (`updateClient` merges `properties`)

## Security / Permissions

1. Updating default contact requires existing client update permission (already enforced by `updateClient`).
2. Inbound email processing runs server-side using admin DB access; ensure tenant scoping is always applied.

## Observability

Not in scope for this phase (follow existing logging patterns only).

## Rollout / Migration

1. No DB migration required if we store default contact in `clients.properties.primary_contact_id`.
2. Existing behavior remains unchanged for clients without a configured default contact and for senders without domain matches.

## Open Questions

1. Should domain-to-client resolution consider inactive contacts (and/or clients) or strictly active-only?
2. Should domain matching treat subdomains specially (e.g. `user@it.acme.com` matching `acme.com`) or require exact domain?
3. When domain match sets a default contact, should the created **comment author** be treated as a “contact” or remain “system” while ticket contact is set? (Current implementation derives author type from `targetContactId`.)
4. Do we want an explicit client-domain configuration UI/table in a later phase, instead of deriving from existing contacts?

## Acceptance Criteria (Definition of Done)

1. Inbound email new-ticket creation:
   - Exact contact match sets ticket client + contact as before.
   - If exact contact match fails and domain match yields a unique client, ticket `client_id` uses that client.
   - If the matched client has a valid default contact configured, ticket `contact_id` is set to it.
   - If domain match is ambiguous or missing, ticket falls back to inbound defaults `client_id` and keeps `contact_id = null`.
2. Client screen:
   - Admin can set/clear the client “Default contact” via a picker.
   - Selection persists and reloads correctly.
