# AlgaDesk Lightweight Help Desk Product Seam Design

- Date: `2026-05-05`
- Status: Approved for planning

## Summary

Create AlgaDesk as a focused help-desk wedge product within the existing Alga PSA application. AlgaDesk runs from the same codebase, Next.js app, database schema, and background-worker model as PSA, but presents a distinct product surface based on product entitlement. The seam is a product/licensing boundary, not a physical process boundary.

AlgaDesk includes ticketing, clients/contacts, client portal ticketing, ticket attachments, knowledge base, users/teams settings, and email-to-ticket. It excludes billing, contracts, quotes, projects, time entry, scheduling/dispatch, assets/RMM, workflows, service request forms, surveys, extensions, AI chat, reporting, and full document management.

## Product Entitlement Model

Use an entitlement separate from the existing `solo | pro | premium` tier model.

Preferred first cut:

- Add `tenants.product_code` with values such as `algadesk` and `psa`.
- Default all existing tenants to `psa`.
- Provision new AlgaDesk tenants with `product_code = 'algadesk'`.
- Add resolver/assertion APIs so app code does not read the raw column directly:
  - `getTenantProduct(tenantId)`
  - `assertProductAccess(...)`
  - server/client hooks for composition and UI decisions

Tier and add-ons remain orthogonal. Effective access should require product entitlement, RBAC permission, and any tier/add-on gate that applies inside an allowed product surface.

## Recommended Architecture

Adopt a polished product-surface seam rather than hiding PSA modules from the existing shell.

Add a new composition package:

- `@alga-psa/algadesk-composition`

Likely responsibilities:

- AlgaDesk MSP layout/sidebar/dashboard/settings shell
- AlgaDesk ticket list and ticket detail composition
- AlgaDesk client/contact detail composition
- AlgaDesk email-channel and KB-safe settings composition
- AlgaDesk portal composition, either in this package or a paired portal package

AlgaDesk composition should depend on shared/core domains only:

- tickets
- clients/contacts
- users/teams
- tags/reference data
- auth/authorization/tenancy
- email/notifications needed for ticket email
- ticket-attachment and KB-safe document APIs

It should not import billing, projects, assets, scheduling, SLA, workflows, surveys, extensions, or AI/chat.

## MSP Product Surface

AlgaDesk includes these MSP pages:

- `/msp/dashboard` — AlgaDesk dashboard only: open tickets, aging, awaiting customer/internal, recent activity, and email channel health.
- `/msp/tickets`
- `/msp/tickets/[id]`
- `/msp/clients`
- `/msp/clients/[id]`
- `/msp/contacts`
- `/msp/contacts/[id]`
- `/msp/knowledge-base` — KB articles only, not full document library.
- `/msp/settings` with AlgaDesk tabs only:
  - General
  - Users
  - Teams
  - Ticketing
  - Email channels / inbound email
  - Client Portal
  - Knowledge Base
  - Profile/Security where appropriate

Ticket detail should keep comments, assignment, boards, statuses, priorities, categories, tags, attachments, email thread visibility, and client/contact context. It should omit SLA cards, project/task linking, time entry controls, asset panels, and survey cards.

## Client Portal Product Surface

AlgaDesk client portal includes:

- `/client-portal/dashboard`
- `/client-portal/tickets`
- `/client-portal/tickets/[ticketId]`
- free-form ticket creation
- `/client-portal/knowledge-base`
- `/client-portal/profile`
- `/client-portal/client-settings`

It excludes billing, projects, devices/assets, documents library, appointments, and service request forms.

## Route and Boundary Behavior

Keep current public routes as canonical for now, with product-aware composition. Later `/desk/*` aliases can point to the same AlgaDesk compositions.

For AlgaDesk tenants:

- Allowed routes render AlgaDesk compositions.
- Major excluded human-facing routes render a branded upgrade boundary, e.g. billing, projects, assets, workflow editor, scheduling, surveys.
- Internal/deep/test/API-like routes return not-found or product-denied.
- Navigation and portal sidebars never link to excluded surfaces.

For PSA tenants, existing PSA behavior should remain unchanged.

## API and Server Action Enforcement

Create one authoritative product surface registry that can project allowed route groups, navigation items, API groups, and metadata/OpenAPI visibility.

AlgaDesk API allowlist:

- tickets, comments, assignment, attachments
- boards, statuses, priorities, ticket categories
- clients, contacts, locations
- users, teams, roles/permissions needed for assignment/admin
- tags
- KB articles
- email-to-ticket endpoints/webhooks/config
- product/feature metadata required by clients

AlgaDesk API denylist:

- billing, invoices, quotes, contracts, accounting exports
- projects/tasks
- assets/RMM
- scheduling, time entry, dispatch
- workflows/automation
- extensions
- AI/chat
- surveys
- full document management
- integrations outside required email-channel paths

Most `/api/v1/*` routes use `ApiBaseController`; add product access after tenant resolution and before controller execution. Standalone API routes and high-risk server actions need explicit product assertions. API metadata, OpenAPI, and docs must filter out blocked endpoints for AlgaDesk tenants.

Server actions require both composition discipline and assertions. AlgaDesk components should not import excluded action modules. Billing, projects, workflows, scheduling, assets/RMM, extensions, AI, and surveys should add explicit product-denied checks at their server-action boundaries.

## Package and Component Seams

### Tickets

Use existing injection seams in `TicketDetails`:

- omit survey summary
- omit associated assets
- omit project task creation/linking
- omit interval/time-management controls
- omit SLA registration
- include email conversation/log visibility
- include attachment upload/view/delete providers
- keep client/contact rendering

Where ticket components dynamically import document actions directly, introduce an attachment provider so AlgaDesk uses only ticket-attachment/KB-safe document functions.

### Clients

AlgaDesk should use narrowed client exports for:

- client CRUD
- contact CRUD
- locations
- support-relevant notes/interactions if retained

It should not import contracts, contract lines, billing config, tax rates, or service catalog surfaces. If needed, add `@alga-psa/clients/core-actions` and `@alga-psa/clients/core-components` entrypoints.

### Client Portal

Split broad portal barrels so AlgaDesk can import only dashboard, tickets, ticket creation, KB, profile, and client settings. Billing, projects, documents library, devices, appointments, notifications beyond ticket needs, and service requests should live behind separate entrypoints or full-PSA composition.

## Email-to-Ticket

Email-to-ticket is core AlgaDesk functionality.

Included:

- Configure inbound support mailbox/channel.
- Map inbound email to board/category/default priority.
- Create tickets from new inbound messages.
- Add public comments from replies.
- Preserve thread/message metadata for dedupe.
- Send outbound ticket notifications/replies.
- Show useful email delivery/thread status in ticket detail.
- Show basic failure state for disconnected mailboxes, webhook/polling failures, and outbound delivery failures.

Excluded:

- broad integrations settings outside email
- workflow-driven email automations
- surveys after ticket close
- billing/project notification templates
- advanced managed-domain administration unless required for delivery

Existing background services/workers may remain separate runtime processes. The product seam is licensing/composition, not forcing queue/polling work into the Next request process.

## Rollout Plan

1. Entitlement foundation
   - Add `product_code`.
   - Default existing tenants to `psa`.
   - Add resolver/assertion helpers and tests.
2. AlgaDesk shell
   - Add layout/sidebar/dashboard/settings shell.
   - Switch composition based on product entitlement.
   - Avoid PSA cross-feature providers in AlgaDesk layout.
3. Core pages
   - Tickets, ticket detail, clients, contacts, KB.
   - Remove/inject away PSA-only controls.
4. Portal
   - Add AlgaDesk portal layout/sidebar and allowed pages.
   - Hide excluded portal surfaces.
5. Email
   - Add focused email channel settings.
   - Product-gate inbound/outbound email paths.
6. Hard boundaries
   - Direct-route upgrade/not-found behavior.
   - API/controller enforcement.
   - Metadata/OpenAPI filtering.
   - High-risk server-action assertions.

## Testing Strategy

Unit tests:

- product resolver
- route/capability registry
- menu filtering
- API group allow/deny classification

Component tests:

- AlgaDesk sidebar exposes only allowed links
- ticket detail omits PSA-only controls
- portal sidebar exposes only dashboard, tickets, KB, profile/settings

Integration/API tests:

- AlgaDesk tenant can use ticket/client/contact/KB/email endpoints
- AlgaDesk tenant gets product-denied for billing/projects/assets/workflows/etc.
- PSA tenant behavior remains unchanged
- AlgaDesk API metadata/OpenAPI does not advertise blocked endpoints

Playwright smoke tests:

- MSP happy path: login, dashboard, create ticket, comment/reply, attach file, inspect client/contact context.
- Portal happy path: portal login, create ticket, view response, use KB.
- Direct URL boundary checks for major excluded pages.

## Open Implementation Notes

- Decide whether `product_code` lives directly on `tenants` or is backed by a future entitlement table; first cut should expose only resolver APIs either way.
- Define the branded upgrade boundary copy and whether it differs by route group.
- Identify exact email settings needed for first AlgaDesk launch.
- Confirm whether support notes/interactions are retained in client/contact detail for AlgaDesk v1.
