# PRD — Store-only service request submissions

- Slug: `store-only-service-request-submissions`
- Date: `2026-09-02`
- Status: Approved for implementation by XO under conn delegation

## Summary

Allow administrators to configure a questionnaire/service request to retain a completed response without creating a support ticket. Reuse the existing versioned service-request submission record and history surfaces.

## Problem

Today the built-in execution provider is ticket-only. Customers who need to collect durable onboarding questionnaire data must create a ticket even when no support work is requested, mixing intake records with operational tickets and triggering ticket-specific side effects.

## Goals

- Make store-only an explicit execution mode.
- Preserve the raw, versioned response and attachments in existing submission storage.
- Show retained submissions through existing MSP and client account-scoped history.
- Guarantee store-only creates no ticket, ticket notification/event, or workflow execution.
- Make portal retries idempotent.
- Preserve existing ticket-only behavior and defaults.

## Non-goals

- Structured account/asset field mapping.
- Synthetic or hidden tickets.
- A new questionnaire persistence model.
- A general destination workflow builder.
- Customer communication.

## Users and Primary Flows

An administrator selects Store only in the service-request definition editor and publishes it. A client portal user completes the form. Alga validates and stores the immutable response, marks execution successful without downstream execution, and shows it in My Requests and the MSP definition's submission history. Retrying the same form attempt returns the original result.

## UX / UI Notes

- Provider option label: `Store only`.
- Supporting copy: the completed response is retained and no support ticket is created.
- Ticket-routing fields are hidden for store-only.
- History rows show a successful retained submission with no ticket link; absence of a ticket is not rendered as an error.

## Requirements

### Functional Requirements

- Register `store-only` through the existing execution-provider registry.
- Snapshot the mode in published definition versions.
- Persist payload, attachments, requester, client/contact, submission time, and definition version before execution.
- Complete store-only rows successfully with null ticket/workflow ids.
- Reuse current MSP/client submission history and authorization boundaries.
- Add a durable, tenant-scoped client submission key for idempotent retries and concurrency.
- Leave `ticket-only` as the default and preserve its behavior.

### Non-functional Requirements

- Tenant isolation on every new lookup and unique constraint.
- No source-string-only tests.
- No ticket-specific side effects on store-only.
- Published behavior must remain stable when a draft later changes modes.

## Data / API / Integrations

Add nullable `client_submission_key` to `service_request_submissions` with a partial tenant/requester/definition unique index. Extend the portal submit action and shared submission input/result. No new response table is required.

## Security / Permissions

Existing visibility validation runs before persistence. Existing client history remains client-scoped; MSP history remains permission-protected and definition-scoped. The idempotency lookup includes tenant, requester, and definition so keys cannot reveal or collide with another account's submission.

## Observability

Existing service-request submission created/updated search events continue. Store-only must not publish ticket-domain events. Failed validation remains user-visible through existing action errors.

## Rollout / Migration

The new column is nullable and existing definitions remain `ticket-only`; no backfill is needed. Deploy migration before application code. The UI exposes the new option only after its provider is registered.

## Open Questions

None blocking. The provider registry is the chosen extension seam; structured mappings remain separate work.

## Acceptance Criteria (Definition of Done)

- Store-only can be selected, published, reloaded, and submitted.
- The full response is retrievable from the correct client/account context.
- Store-only creates zero tickets and zero ticket/workflow side effects.
- Ticket-only still stores the response and creates exactly one ticket.
- Same-key retries/concurrency return one submission and execute at most once.
- Cross-client/tenant reads and idempotency collisions are denied by scope.
