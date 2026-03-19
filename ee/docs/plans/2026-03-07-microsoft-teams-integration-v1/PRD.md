# PRD — Microsoft Teams Integration V1

- Slug: `microsoft-teams-integration-v1`
- Date: `2026-03-07`
- Status: Draft

## Summary

Deliver a Microsoft Teams integration for MSP users that treats Teams as a single tenant-bound integration with four user-facing surfaces:

1. Personal tab for rich PSA record viewing and heavier workflows
2. Personal-scope command/workflow bot for common technician actions
3. Message extension for lookup and message-to-ticket / message-to-update flows
4. Personal activity-feed notifications with deep links back into PSA

The integration is configured per PSA tenant by an admin and uses a tenant-selected Microsoft profile. The existing single Microsoft integration settings model will be expanded into named Microsoft profiles so a tenant can manage multiple Microsoft app registrations and explicitly bind one profile to Teams. V1 supports MSP users only, reuses the existing Microsoft provider configuration and SSO foundations, and deliberately takes the simpler notification approach: personal notifications only, not channel/chat routing.

## Problem

PSA users who live in Teams need a fast way to see work, act on work, and get notified about work without switching constantly between Teams and the PSA web app. Today the product has Microsoft OAuth foundations, internal notification infrastructure, deep linking, and Microsoft provider configuration, but no Teams-native operating surface. Without a Teams integration:

- technicians must leave Teams to inspect tickets, tasks, approvals, and time-entry work
- message-driven work in Teams cannot be converted quickly into PSA records
- important work events depend on email or in-app PSA notifications instead of Teams activity feed
- each Microsoft integration capability risks becoming its own credential silo instead of reusing a tenant-owned Microsoft app registration model

The product opportunity is to put the right PSA interactions into the right Teams primitives while avoiding a second identity and eventing stack.

## Goals

1. Provide a Teams app shell centered on a personal tab for rich PSA record viewing and deep-link landing
2. Provide Teams SSO across the tab, bot, and message extension using a tenant-owned Microsoft profile selected by an admin
3. Deliver personal activity-feed notifications for key PSA work events that open exact PSA records
4. Provide a personal-scope bot for high-frequency technician commands and workflow actions
5. Provide a message extension for record lookup, message-to-ticket, and message-to-update workflows
6. Provide adaptive-card/dialog-based quick actions for common workflows that should not require the full tab UI
7. Expand Microsoft integration settings into named profiles and allow consumer binding so Teams can reuse tenant-owned Microsoft registrations cleanly
8. Keep v1 operationally simple by limiting scope to MSP users, personal notifications, and admin-selected profile binding

## Non-goals

- Client-portal user Teams experiences
- Channel-targeted or chat-targeted notification routing in v1
- Channel-first bot conversations as a primary UX
- A general-purpose AI chatbot for Teams
- Full PSA parity inside Teams for every screen and workflow
- Separate Teams-owned credential storage disconnected from the existing Microsoft provider model
- Replacing the PSA web app as the source of truth for complex workflows
- Reworking every existing Microsoft integration consumer to expose full profile-selection UX on day one if a migration-safe default binding is sufficient
- New operational telemetry, analytics, or rollout infrastructure beyond what is required for the core product behavior

## Users and Primary Flows

### Personas

- **MSP tenant admin**: configures named Microsoft profiles, binds a profile to Teams, completes consent/setup, chooses allowed Teams actions, and controls notification preferences
- **Technician / agent**: uses the Teams personal tab, bot, message extension, and activity feed to manage tickets, tasks, approvals, contacts, and time work
- **Dispatcher / team lead / approver**: receives Teams notifications, opens records quickly, and uses lightweight action flows from Teams

### Primary Flows

#### Flow 1: Admin configures Teams with a named Microsoft profile
1. Admin opens Microsoft integration settings
2. Admin creates or edits one or more named Microsoft profiles
3. Admin selects one profile for Teams
4. Admin completes Teams/Entra setup and consent using the selected profile
5. Admin configures which Teams capabilities are enabled and what notification categories are allowed

#### Flow 2: Technician opens the Teams personal tab
1. Technician opens the PSA Teams app in personal scope
2. Teams SSO identifies the user and tenant
3. PSA resolves the user session and tenant context using the tenant-selected Microsoft profile
4. The tab opens a landing view or deep-linked PSA entity view such as a ticket, task, approval, or time-entry workflow

#### Flow 3: Technician uses personal bot commands
1. Technician opens the PSA personal bot in Teams
2. Technician enters a focused command such as `my tickets`, `ticket 12345`, `assign ticket`, `add note`, `reply to contact`, or `log time`
3. Bot resolves the target entity and permission context
4. Bot returns a summary, link, or quick-action card/dialog
5. If the action is completed in Teams, the bot confirms the result and offers a deep link back to PSA

#### Flow 4: User creates or updates work from a Teams message
1. User invokes the PSA message extension from a message or compose surface
2. User searches PSA records or chooses a message-based action
3. User creates a ticket from the message or appends the message to an existing PSA record
4. Teams shows the result and the user can open the full PSA record in the tab or web app

#### Flow 5: Technician receives a Teams activity notification
1. PSA emits a work event such as assignment, customer reply, approval request, escalation, or SLA risk
2. Existing notification payload generation resolves title, body, metadata, and deep link
3. Teams delivery sends a personal activity-feed notification to the target technician
4. Technician clicks the notification and lands directly in the Teams tab or PSA deep link for the exact record

#### Flow 6: Technician completes a quick action without leaving Teams
1. User invokes a bot or message-extension action
2. Teams opens an adaptive-card or dialog form
3. User enters a small amount of information such as assignee, note content, reply text, or time amount
4. PSA validates permissions and completes the action
5. Teams shows confirmation and a deep link for follow-up work

#### Flow 7: Approver uses Teams to handle lightweight approvals
1. Approver receives an activity notification or opens the bot
2. Approver opens an approval-related task or command result
3. Teams presents the approval summary and allowed actions
4. Approver completes the action in Teams or opens the richer PSA screen if more context is needed

## UX / UI Notes

- The **personal tab** is the anchor UI for record-heavy work. It should feel like a Teams-hosted PSA view, not a second standalone product.
- The **bot** should remain command-first and narrow in scope. It is not a vague general chatbot; it is a focused action surface for known PSA workflows.
- The **message extension** should emphasize contextual work from messages: search PSA records, create ticket from message, add note/update from message, and open full record.
- **Adaptive cards/dialogs** should be used only for short, structured inputs that clearly save a context switch.
- **Personal notifications** are the only notification target in v1. Channel/chat routing is deferred.
- **Channel/group usage** in v1 should be limited to message-extension entry points and contextual creation flows, not conversational bot depth.
- **Settings UX** should expand the existing Microsoft integration screen into a profile manager rather than creating a disconnected Teams-only credential editor.
- **Teams setup UX** should sit as a tenant integration flow that references one selected Microsoft profile instead of duplicating client ID/secret entry.

## Requirements

### Functional Requirements

#### A. Microsoft profile model and consumer binding

- FR-A1: Replace the current single Microsoft integration config model with named Microsoft profiles owned by a tenant
- FR-A2: Each Microsoft profile stores client ID, client secret, tenant ID, display name, status metadata, and audit-safe masked display state
- FR-A3: Existing tenants with a single Microsoft configuration must migrate to a default named profile without losing current functionality
- FR-A4: The system must support consumer binding so a tenant integration can reference a selected Microsoft profile instead of owning credentials directly
- FR-A5: Teams must bind to exactly one Microsoft profile at a time in v1
- FR-A6: Existing Microsoft consumers that are not explicitly migrated to profile selection UX must continue to function via a migration-safe default binding or equivalent compatibility path

#### B. Teams tenant integration setup

- FR-B1: Add a tenant-admin Teams integration setup surface
- FR-B2: Teams setup must require selection of one named Microsoft profile
- FR-B3: Teams setup must show the redirect URIs, scopes, and app-registration information required for the selected profile
- FR-B4: Teams setup must track installation / configuration state for the tenant
- FR-B5: Teams setup must let the admin enable or disable Teams capabilities within the selected v1 scope
- FR-B6: Teams setup must let the admin configure Teams notification preferences for supported notification categories
- FR-B7: Teams setup must define allowed Teams actions for v1 quick actions

#### C. Teams app shell and identity

- FR-C1: Provide a Teams app package with personal tab, personal bot, message extension, and activity-feed capability declarations
- FR-C2: Teams SSO must resolve to MSP users only in v1
- FR-C3: Teams tab, bot, and message extension must reuse the selected Microsoft profile for Teams identity and consent
- FR-C4: Teams-authenticated requests must resolve PSA tenant and user context correctly
- FR-C5: Deep links from notifications and commands must land users on the exact PSA record or workflow context

#### D. Personal tab

- FR-D1: Provide a Teams personal tab entry point for PSA
- FR-D2: The personal tab must support landing views for “my work” style entry
- FR-D3: The personal tab must support deep-link opening for tickets, tasks, approvals, and time-entry-related workflows
- FR-D4: The tab must open heavier workflows that should not be completed via cards/dialogs
- FR-D5: The tab must preserve tenant and user authorization rules equivalent to PSA web access

#### E. Personal bot

- FR-E1: Provide a personal-scope Teams bot for MSP users
- FR-E2: Bot v1 commands must include `my tickets`
- FR-E3: Bot v1 commands must include `ticket <id>`
- FR-E4: Bot v1 commands must include `assign ticket`
- FR-E5: Bot v1 commands must include `add note`
- FR-E6: Bot v1 commands must include `reply to contact`
- FR-E7: Bot v1 commands must include `log time`
- FR-E8: Bot v1 commands must include approval-oriented flows in scope for v1
- FR-E9: Bot responses must reuse shared PSA command/action execution logic instead of implementing each action separately per surface

#### F. Message extension

- FR-F1: Provide a Teams message extension
- FR-F2: Message extension search must support PSA record lookup
- FR-F3: Message extension search must support tickets
- FR-F4: Message extension search must support tasks
- FR-F5: Message extension search must support contacts
- FR-F6: Message extension search must support approval-related records or work items needed for v1
- FR-F7: Message extension action commands must support creating a ticket from a Teams message
- FR-F8: Message extension action commands must support appending a Teams message as an update or note to an existing PSA record
- FR-F9: Message extension results must provide deep links into the personal tab or PSA web view as appropriate

#### G. Quick actions via adaptive cards / dialogs

- FR-G1: Shared quick-action infrastructure must support bot and message-extension invocation paths
- FR-G2: Quick actions must collect minimal structured inputs for assign ticket, add note, reply to contact, log time, and relevant approvals
- FR-G3: Quick actions must validate permissions and entity state before execution
- FR-G4: Quick actions must return confirmation, failure messaging, and deep-link follow-up paths

#### H. Notifications

- FR-H1: Teams notifications must reuse existing PSA notification/event generation rather than introducing a separate trigger model
- FR-H2: Teams notifications must support personal activity-feed delivery only in v1
- FR-H3: Teams notification categories in v1 must include assignment-related events
- FR-H4: Teams notification categories in v1 must include customer replies
- FR-H5: Teams notification categories in v1 must include approval requests
- FR-H6: Teams notification categories in v1 must include escalations
- FR-H7: Teams notification categories in v1 must include SLA risk events
- FR-H8: Teams notifications must reuse centralized deep-link resolution for PSA records

#### I. Permissions and tenancy

- FR-I1: All Teams surfaces must enforce MSP user authentication only
- FR-I2: All Teams actions must enforce existing PSA permissions for the underlying records and operations
- FR-I3: Tenant admin setup must be limited to authorized settings/integration administrators
- FR-I4: Teams actions must never expose records outside the user’s tenant
- FR-I5: Teams actions must fail safely when the tenant has not completed Teams setup or the selected Microsoft profile is invalid

#### J. Backward compatibility and rollout shape

- FR-J1: Existing non-Teams Microsoft integrations must continue to work during migration to named profiles
- FR-J2: A tenant without Teams setup must see no Teams behavior
- FR-J3: V1 scope must ship with personal-notification-only semantics and no channel-routing requirement
- FR-J4: V1 scope must ship with MSP-user-only semantics and no client-portal Teams support
- FR-J5: V1 scope must keep the Teams bot personal-first and not require channel conversational parity
- FR-J6: The plan may use feature flags where needed, but v1 functionality should be designed as a cohesive tenant integration rather than a scattered collection of unrelated toggles

### Non-functional Requirements

- NFR-1: Teams must be modeled as one tenant integration with multiple surfaces, not four separate configuration domains
- NFR-2: Microsoft profile selection for Teams must be explicit and deterministic
- NFR-3: Shared action execution should minimize duplication across bot, message extension, quick actions, and tab entry points
- NFR-4: Existing deep-link generation should remain the single source of truth for record links
- NFR-5: Existing notification/event infrastructure should remain the trigger source for Teams delivery
- NFR-6: Tenant data isolation and existing authorization semantics must be preserved across all Teams surfaces
- NFR-7: V1 should prefer the simpler scope when a richer Teams capability would materially increase product and implementation complexity without clear MVP value

## Data / API / Integrations

### Simplification Cascades

The plan intentionally uses three simplification cascades:

1. **Teams is one integration, not four products.**
   The tab, bot, message extension, and notifications share one tenant integration record, one selected Microsoft profile, and one setup flow.
2. **Bot commands and message-extension actions are one action system.**
   Invocation surfaces differ, but the underlying PSA action definitions, permission checks, entity resolution, and result mapping should be shared.
3. **Teams notifications are one more delivery channel for existing notification payloads.**
   Existing notification payload generation and deep-link resolution should feed Teams delivery instead of creating a parallel event and templating stack.

### Data model direction

- Introduce a tenant-scoped Microsoft profile entity for named profile records
- Introduce a tenant-scoped consumer-binding model so Teams can reference one selected profile
- Introduce a tenant-scoped Teams integration entity to track setup/configuration state, selected profile, capability enablement, and notification preferences
- Introduce storage for Teams user / installation linkage as needed to support personal notifications, SSO resolution, and app-scope identity mapping
- Introduce any minimal request/command state needed to support bot and message-extension quick actions

### API / service direction

- Reuse the existing Microsoft integration settings actions as the base for profile management
- Add Teams integration setup actions and API routes for admin setup, selected-profile binding, and integration status
- Add Teams-facing endpoints / handlers for:
  - tab bootstrap and deep-link landing
  - bot command execution
  - message extension search and action execution
  - adaptive-card / dialog action submission
  - activity-feed notification delivery triggers or delivery orchestration
- Reuse existing notification link resolution rather than building Teams-specific record URL generation
- Reuse existing Microsoft SSO / OAuth secret resolution patterns for profile-backed credential lookup

### Affected integration areas

- Microsoft integration settings UI and actions
- NextAuth / MSP SSO Microsoft provider resolution
- Notification generation and delivery orchestration
- Existing domain event / workflow event surfaces
- Ticket, task, approval, contact, and time-entry action surfaces used by Teams actions
- Teams app manifest / package generation and install flow

## Security / Permissions

- Teams setup and profile binding require tenant integration administration permission
- All Teams action execution must reuse PSA authorization checks for the underlying operation
- The system must resolve only MSP users in v1; client users must not authenticate into Teams flows
- Teams deep links must not expose cross-tenant URLs or entity IDs without authorization
- Microsoft profile secrets must continue to be stored through the existing tenant secret infrastructure
- Teams quick actions must fail closed on missing profile binding, missing consent, missing mapping, or insufficient PSA permissions

## Observability

- Reuse existing notification delivery lifecycle semantics where possible for Teams notification send, delivered, and failed states
- Reuse existing integration-status patterns for Teams setup and readiness reporting
- Do not add broad new observability scope beyond what is needed to support Teams setup troubleshooting and delivery-state visibility

## Rollout / Migration

- Migrate existing singleton Microsoft config into a default named Microsoft profile
- Keep existing Microsoft consumers functional through a compatibility path while named profiles are introduced
- Add Teams as a new tenant integration that is inert until configured
- Limit v1 rollout to MSP users only and personal-notification-only semantics
- Defer channel routing, client user support, and richer group/channel bot behavior until later phases

## Open Questions

- Whether existing Microsoft consumers beyond Teams need explicit per-consumer profile selection UX in v1 or can remain on default binding initially
- Exact Teams approval surface coverage for v1, especially how much approval context should be in quick actions versus the tab
- Exact install/distribution mechanics for the Teams app package across tenants and environments

## Acceptance Criteria (Definition of Done)

1. Tenant admins can manage named Microsoft profiles instead of a single Microsoft config
2. A tenant admin can bind exactly one Microsoft profile to Teams setup
3. Existing Microsoft integrations continue to work after migration to named profiles
4. MSP users can sign into the Teams tab, bot, and message extension using the tenant-selected Microsoft profile
5. The Teams personal tab opens PSA landing content and exact deep-linked tickets, tasks, approvals, and time-related flows
6. The personal bot supports the agreed v1 command set and completes supported actions with permission enforcement
7. The message extension supports lookup and message-to-ticket / message-to-update workflows
8. Shared quick-action flows work from bot and message extension entry points using adaptive cards or dialogs where appropriate
9. Teams activity-feed notifications are delivered personally for the selected v1 categories and open exact PSA records via deep links
10. All Teams functionality is limited to MSP users in v1
11. Channel/chat routing is not required for v1 and no channel notification setup is needed
12. The implementation reuses the existing Microsoft provider, notification, deep-link, and auth foundations rather than introducing parallel systems
