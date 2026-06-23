# PRD — Default Notification Contact per RMM Organization Mapping

- **Ticket:** alga0001998 (Shift Left Security — Erwin Geirnaert)
- **Date:** 2026-06-19
- **Status:** Draft (pending scope confirmation)

## Problem Statement & User Value

RMM org-mappings (`rmm_organization_mappings`) map an external RMM organization to an AlgaPSA **client only** — there is no way to attach a **contact**. AlgaPSA's client-facing email notifications (e.g. "Ticket Created Client" / "Your Ticket Has Been Created") require a contact recipient, so tickets auto-created by an RMM integration notify **no one** — even when the relevant notification types are enabled.

Two underlying gaps in the integration ticket-create paths cause this (both confirmed in code):

1. They never set `tickets.contact_name_id`.
2. They never publish a `TICKET_CREATED` event, so the notification subscriber (`server/src/lib/eventBus/subscribers/ticketEmailSubscriber.ts → handleTicketCreated`) never runs. (The shared pipeline publishes only `RMM_ALERT_TRIGGERED`, a workflow event — not the email trigger.) This is why the reporter saw "No email notifications found."

**Value:** MSPs can have RMM-incident tickets notify the customer natively — by choosing a default notification contact per mapped organization, with automatic fallback to the client's primary/default contact — instead of building external automation (n8n/webhook) to set a contact and post a public comment.

## Goals

- Add a per-mapping **Default Notification Contact** (`default_contact_id`) to `rmm_organization_mappings` (the table shared by all RMM providers).
- At ticket-create time, set `tickets.contact_name_id` to: the mapping's `default_contact_id` when set and valid, else the client's primary/default contact when valid, else none.
- Publish the standard `TICKET_CREATED` event from the integration create paths so the tenant's configured client-facing notifications fire.
- Apply the fix in the **shared RMM layer** so every provider benefits: Huntress (bespoke path) and NinjaOne / Tactical RMM / Level / Tanium (shared pipeline).
- Expose the contact picker in the org-mapping UIs of **all five RMM providers** (Huntress, NinjaOne, Tactical RMM, Level, Tanium) — each has an org→client mapping screen — with an inline **"Add new contact"** option (same dialog as the new-ticket flow).

## Non-Goals

- No pulling contacts from the RMM itself — the notification recipient must be an AlgaPSA contact. RMM-sourced contacts (only NinjaOne realistically exposes them) are a possible follow-up, not part of this branch. *(Correction: an earlier draft excluded Tactical/Level/Tanium from the UI on the false premise that they lacked an org-mapping screen. All five have one, and all five now have the picker.)*
- No backfill of `default_contact_id` on existing mappings (null → client-default fallback applies).
- No change to notification templates, notification-type configuration, or the subscriber logic itself.
- No new operational tooling, metrics, retries, or feature flags.

## Target Users & Primary Flows

**Persona:** MSP technician/admin configuring an RMM integration.

**Flow A — set a default contact:** Settings → Integration (any of Huntress, NinjaOne, Tactical, Level, Tanium) → Organization Mapping. For a mapped org, pick a **Default Contact** (filtered to the mapped client's contacts) — or **Add new contact** inline. Saved immediately.

**Flow B — incident creates a ticket:** An RMM incident/alert for that org auto-creates a ticket. The ticket is associated with the resolved contact (mapping default → client default), and the client receives the configured "Ticket Created" email.

**Flow C — fallback:** A mapping with no default contact set still resolves the client's primary/default contact, so notifications fire without per-mapping configuration.

## Contact Resolution (core rule)

`resolveRmmTicketContactId(trx, tenant, { clientId, mappingDefaultContactId })`:

1. If `mappingDefaultContactId` is set → use it **only if** the contact exists, `is_inactive = false`, and `client_id === clientId`.
2. Else → resolve `clients.properties.primary_contact_id`, validated the same way.
3. Else → `null` (ticket created with no contact; behavior unchanged for that ticket).

Mirrors the validation in `findValidClientPrimaryContactId` (`shared/workflow/actions/emailWorkflowActions.ts:440`) but runs on the caller's transaction.

## Data Model / Integration Notes

- **Table:** `rmm_organization_mappings` (CE migration dir `server/migrations/`; created by `20251124000001_create_rmm_integration_tables.cjs`).
- **New column:** `default_contact_id uuid NULL` + index `(tenant, default_contact_id)`. **No database foreign key:** Citus rejects `ON DELETE SET NULL` on a tenant-scoped FK (it would null the distribution column). Instead the reference is cleared in the backend on contact deletion (`deleteContact` nulls it in the same transaction), and the runtime resolver validates the contact on read, so a dangling reference is harmless.
- **Citus:** plain nullable `ADD COLUMN` + index — fully Citus-safe (no FK, no distribution-column SET NULL). Verified by applying `up()`/`down()` against Postgres.
- **Event:** publish `TICKET_CREATED` after the create transaction commits via `TicketModelEventPublisher` (`packages/tickets/src/lib/adapters/TicketModelEventPublisher.ts`); the no-trx publisher publishes immediately and swallows publish errors, so it never breaks ticket creation.

## Affected Code (anchors)

| Area | Path |
| --- | --- |
| Migration | `server/migrations/<new>_add_default_contact_to_rmm_org_mappings.cjs` |
| Contact resolver (new) | `shared/rmm/alerts/resolveContact.ts` |
| Shared create + threading | `shared/rmm/alerts/ticketCreator.ts`, `processRmmAlertEvent.ts`, `createTicketForAlertId.ts` |
| Huntress create + threading | `ee/server/src/lib/integrations/huntress/incidents/ticketCreator.ts`, `incidentProcessor.ts` |
| Type | `ee/server/src/interfaces/rmm.interfaces.ts` (`RmmOrganizationMapping`) |
| Backend actions (all 5) | `huntressActions.ts`, `ninjaoneActions.ts`, `tacticalRmmActions.ts`, `levelIoActions.ts`, `taniumActions.ts` |
| Settings UI (all 5) | Huntress/NinjaOne `OrganizationMappingManager.tsx`; Tactical/Level/Tanium `*IntegrationSettings.tsx` |
| Backend deletion unlink | `packages/clients/src/actions/contact-actions/contactActions.tsx` (`deleteContact`) |
| Add-new-contact wiring | `packages/ui/src/context` (`useQuickAddClient`/`renderQuickAddContact`) |
| Dialog UI fixes | `packages/integrations/.../RmmAlertAutomationSettings.tsx` (scroll + custom `Checkbox`) |
| Contact picker | `packages/ui/src/components/ContactPicker.tsx` (reuse; `onAddNew`) |

## Risks & Rollout

- **Broader event emission:** publishing `TICKET_CREATED` fires *all* ticket-created subscribers for integration tickets (client email, workflow triggers, assignment, analytics) — previously none ran. This is the intended "use the standard flow" behavior; called out so it is a conscious change.
- **Notification volume:** clients now receive emails for RMM-incident tickets where they previously received none — expected and desired, but a behavior change for existing tenants.
- **Contact validity:** resolver guards against inactive/cross-client contacts so a stale `primary_contact_id` or a re-mapped client can't leak a wrong recipient.

## Acceptance Criteria / Definition of Done

1. Migration adds `default_contact_id` (+ FK/index) and reverses cleanly.
2. Huntress and NinjaOne org-mapping UIs show a Default Contact picker, filtered to the mapped client's contacts, disabled when no client is mapped; selection persists via the update action.
3. A Huntress incident and a shared-pipeline (e.g. Tactical/NinjaOne) alert each create a ticket whose `contact_name_id` = mapping default (when set) else client default (when valid).
4. Those create paths publish `TICKET_CREATED`, and the tenant's configured client-facing "Ticket Created" notification is sent (visible in Email Notification Logs).
5. When no valid contact resolves, the ticket is still created (no contact) and nothing regresses.
6. Resolver and pipeline tests pass; existing RMM alert pipeline tests stay green.

## Open Questions

- None blocking. (Plan placed under `docs/plans/` to match the related `2026-06-12-rmm-alert-handling` plan; move to `ee/docs/plans/` if the Ralph loop requires it.)
