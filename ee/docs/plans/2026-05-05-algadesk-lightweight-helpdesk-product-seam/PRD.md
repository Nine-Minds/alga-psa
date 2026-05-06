# PRD — Algadesk Lightweight Help Desk Product Seam

- Slug: `2026-05-05-algadesk-lightweight-helpdesk-product-seam`
- Date: `2026-05-05`
- Status: Draft
- Source design: `docs/plans/2026-05-05-algadesk-lightweight-helpdesk-product-seam-design.md`

## Summary

Create Algadesk as a focused help-desk wedge product inside the existing Alga PSA application. Algadesk must feel like a coherent standalone help desk for MSPs that are not ready for the full PSA experience, while continuing to run from the same codebase, Next.js app, database schema, and background-worker model as Alga PSA.

The seam is a product entitlement and composition boundary, not a physical service boundary. PSA tenants keep the existing PSA experience. Algadesk tenants get an intentionally smaller product surface: ticketing, clients/contacts, client portal ticketing, ticket attachments, knowledge base, users/teams settings, and email-to-ticket.

## Problem

Alga PSA contains a broad MSP operating surface. A prospect that only needs a help desk can be overwhelmed by full PSA navigation, settings, data models, integrations, and workflows. Simply hiding sidebar links is insufficient: direct URLs, broad package barrels, API discovery, server actions, and cross-feature providers can still leak the full PSA product into a lightweight tenant.

We need a product seam that is strong enough to create confidence in Algadesk as a standalone product, but pragmatic enough to share the existing application, database, authentication, ticketing, client portal, and email infrastructure.

## Goals

1. Introduce an orthogonal product entitlement separate from `solo | pro | premium` tiers.
2. Render a purpose-built Algadesk MSP shell, navigation, dashboard, settings surface, ticket composition, client/contact composition, and client portal surface.
3. Keep one codebase, one Next.js app, one database schema, and the existing background-worker model.
4. Include email-to-ticket and ticket reply/update by email as core Algadesk functionality.
5. Include ticket attachments and knowledge base without exposing full document management.
6. Enforce product boundaries in browser routes, API routes, API metadata/OpenAPI, and high-risk server actions.
7. Preserve existing PSA behavior for PSA tenants.
8. Support future `/desk/*` aliases without making aliases required for the first launch.

## Non-goals

1. Do not split Algadesk into a separate repository, deployment, Next app, database, or physical process boundary.
2. Do not make Algadesk another value in the existing PSA tier ladder.
3. Do not include billing, contracts, quotes, projects, project tasks, time entry, scheduling, dispatch, assets/RMM, workflows, service request forms, surveys, extensions, AI chat, reporting, or full document management in v1.
4. Do not attempt comprehensive test coverage for every feature checklist item. Use confidence-building tests that validate critical seams and journeys.
5. Do not redesign the entire ticketing, portal, email, or authorization systems.
6. Do not force background email polling, queue processing, or retry logic into the Next.js request process.

## Users and Primary Flows

### MSP owner / admin evaluating Algadesk

1. Signs into an Algadesk tenant.
2. Sees an Algadesk dashboard and help-desk navigation only.
3. Configures users, teams, ticketing basics, client portal, knowledge base, and email channels.
4. Does not see PSA modules such as billing, projects, assets, workflows, or time.

### MSP dispatcher / technician

1. Opens the ticket list.
2. Filters by board, status, priority, category, tag, client, assignee, team, response state, due date, and search.
3. Opens a ticket detail page.
4. Comments, replies, attaches files/images, assigns users/teams, updates status/priority/category, and views client/contact context.
5. Sees email thread/delivery context where useful.
6. Does not see SLA cards, project task links, time entry, asset panels, surveys, AI chat, or billing prompts inside ticket work.

### MSP client portal contact

1. Signs into the client portal.
2. Views a simple portal dashboard.
3. Creates a free-form ticket with description and attachments.
4. Views ticket status and technician replies.
5. Uses knowledge base articles.
6. Manages profile/client settings permitted for portal users.
7. Does not see billing, projects, devices/assets, document library, appointments, service requests, or extensions.

### API consumer for Algadesk

1. Authenticates with an API key.
2. Discovers only Algadesk-allowed API endpoints in metadata/OpenAPI.
3. Can manage tickets, comments, assignment, boards/statuses/priorities/categories, clients, contacts, users/teams as permitted, tags, KB, and email-to-ticket settings.
4. Receives structured product-denied errors for excluded PSA endpoints.

## UX / UI Notes

1. Algadesk should feel like a purpose-built product, not PSA with missing menu items.
2. Use an Algadesk MSP shell/sidebar/dashboard/settings surface instead of the full PSA layout stack.
3. Major excluded human-facing routes should show a branded upgrade boundary: clear copy that the feature belongs to Alga PSA, not a broken route.
4. Deep/internal/test routes can return not-found or product-denied.
5. Algadesk dashboard should focus on open tickets, aging, awaiting customer/internal, recent activity, and email channel health.
6. Algadesk settings should expose only General, Users, Teams, Ticketing, Email Channels, Client Portal, Knowledge Base, Profile/Security where appropriate.
7. Client portal sidebar should expose only dashboard, tickets, KB, profile, and client settings.
8. Ticket detail should retain core ticket collaboration and remove PSA-only affordances.

## Requirements

### Functional Requirements

#### Product entitlement and resolution

1. Add a persisted product entitlement for tenants, initially `psa` or `algadesk`.
2. Existing tenants default to `psa`.
3. Product access should be resolved through shared helpers, not raw column reads throughout app code.
4. Product access should be composable with RBAC, tiers, and add-ons.

#### Algadesk MSP shell

1. Algadesk tenants render an Algadesk-specific MSP layout/sidebar/provider stack.
2. PSA tenants render the existing PSA layout/sidebar/provider stack.
3. Algadesk shell must not import full PSA cross-feature providers for projects, workflows, scheduling, assets, SLA, surveys, extensions, or AI chat.
4. Algadesk navigation exposes only dashboard, tickets, clients, contacts, knowledge base, and allowed settings/profile/security entries.

#### Ticketing

1. Algadesk supports ticket list and ticket detail flows.
2. Algadesk keeps ticket CRUD, comments, public/internal conversation behavior, assignment, boards, statuses, priorities, categories, tags, response state, ticket origin, attachments, and email thread context.
3. Algadesk excludes SLA UI/registration, project task linking, time entry/timer controls, asset panels, surveys, and AI chat.
4. Existing PSA ticket behavior remains unchanged.

#### Clients and contacts

1. Algadesk includes client, contact, and location management needed for support.
2. Algadesk client/contact views include ticket support context.
3. Algadesk excludes contracts, contract lines, billing configuration, tax rates, service catalog, client assets, client surveys, full documents, projects, and time/billing adjacent tabs.
4. Existing PSA client/contact behavior remains unchanged.

#### Knowledge base and attachments

1. Algadesk includes KB articles.
2. Algadesk includes ticket attachments and rich-text image uploads where tied to ticket comments.
3. Algadesk excludes full document library, folders, broad sharing, and project/client document surfaces.
4. Attachment APIs/components should use a ticket-attachment/KB-safe seam rather than importing full document management where avoidable.

#### Client portal

1. Algadesk client portal includes dashboard, tickets, ticket detail, free-form ticket creation, KB, profile, and client settings.
2. Algadesk client portal excludes billing, projects, devices/assets, document library, appointments, service request forms, and extensions.
3. Existing PSA client portal behavior remains unchanged.

#### Email-to-ticket

1. Algadesk includes inbound support mailbox/channel configuration.
2. Algadesk maps inbound email to board/category/default priority.
3. Algadesk creates tickets from new inbound messages.
4. Algadesk adds public ticket comments from replies.
5. Algadesk preserves message/thread metadata for dedupe.
6. Algadesk sends outbound ticket notifications/replies.
7. Algadesk shows useful mailbox/channel health and delivery/thread status.
8. Algadesk excludes broad non-email integrations and workflow-driven email automations.

#### Route and API boundaries

1. Algadesk allowed browser routes render Algadesk compositions.
2. Algadesk direct hits to major excluded human-facing routes render a branded upgrade boundary.
3. Algadesk direct hits to deep/internal/test routes return not-found or product-denied.
4. Algadesk API access is allowed only for product-allowed API groups.
5. Algadesk API metadata/OpenAPI/docs do not advertise blocked endpoints.
6. High-risk excluded server actions explicitly assert product access.

### Non-functional Requirements

1. Maintain one app/runtime model and avoid creating a physical product fork.
2. Keep the Algadesk composition package dependency-bounded so excluded domains are not imported accidentally.
3. Fail closed for product access decisions: unknown product or unknown surface should not expose PSA functionality to Algadesk tenants.
4. Keep PSA behavior backward-compatible.
5. Prefer incremental seams and targeted composition over large rewrites.

## Data / API / Integrations

1. Add `product_code` to `tenants` or an equivalent first-cut persisted entitlement, with resolver abstraction.
2. Define product constants and tenant interface updates in shared types.
3. Add a product surface registry that classifies capabilities, route groups, navigation groups, API groups, and metadata visibility.
4. Add tenant product resolvers/assertions in the tenancy/server layer.
5. Add product-aware checks to the v1 API controller base and standalone routes as needed.
6. Filter metadata/OpenAPI by product entitlement.
7. Product-gate email webhook/IMAP/OAuth/configuration paths needed for email-to-ticket.

## Security / Permissions

1. Product access is not a replacement for RBAC; both must pass.
2. API keys for Algadesk tenants must not access denied PSA endpoints even when RBAC permissions would otherwise allow the action.
3. Server actions in excluded domains should throw structured product-denied errors for Algadesk tenants.
4. Portal access must continue to enforce tenant/client/contact visibility rules.
5. Browser route hiding must not be the only enforcement layer.

## Observability

No broad observability platform changes are in scope. Algadesk v1 should expose user-facing email channel health in the settings/dashboard surfaces because email-to-ticket is core product functionality.

## Rollout / Migration

1. Add the entitlement schema first and default all existing tenants to `psa`.
2. Add product resolver and registry before product-specific composition changes.
3. Introduce Algadesk shell behind product entitlement.
4. Migrate pages one product surface at a time: dashboard/settings, tickets, clients/contacts/KB, portal, email, hard boundaries.
5. Add route/API enforcement after the allowlist is explicit enough to avoid blocking required Algadesk flows.
6. Validate PSA tenants throughout rollout to prevent regressions.

## Open Questions

1. What exact branded copy and CTA should the upgrade boundary use?
2. Should Algadesk retain client/contact notes and interactions in v1?
3. Which inbound email providers/settings are required for launch versus later?
4. Should `/desk/*` aliases be added immediately after v1 or only when marketing requires them?
5. Should Algadesk have product-specific naming in app chrome or inherit existing Alga branding with Algadesk labels?

## Acceptance Criteria (Definition of Done)

1. Existing PSA tenants continue to use the current PSA product surface.
2. Algadesk tenants see only Algadesk MSP navigation, dashboard, settings, ticketing, clients/contacts, KB, and portal surfaces.
3. Algadesk ticket work supports comments, assignment, statuses/priorities/categories/boards, tags, attachments, and email conversation context.
4. Algadesk email-to-ticket can create tickets and add replies as comments.
5. Algadesk client portal supports free-form ticket creation, ticket viewing, KB, profile, and client settings.
6. Direct browser access to major excluded PSA routes is handled by upgrade/not-found boundaries.
7. Algadesk API clients can use allowed endpoints and cannot discover or access blocked PSA endpoints.
8. High-risk excluded server actions reject Algadesk access.
9. Dependency tests prevent Algadesk composition from importing excluded PSA packages.
10. Confidence-building test suite passes for product resolver, registry, navigation, core MSP/portal flows, email-to-ticket, API boundaries, and PSA regression smoke.
