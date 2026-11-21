# SLA escalation when the manager is the ticket assignee

Status: requirements captured during the Draft Implementation mitigation on 2026-11-03. No approved Design Session plan was available in the repository or in the referenced XO design-artifact location; this file records the concrete acceptance requirements from the card dossier and task instructions.

## Problem

SLA escalation currently adds the configured manager to `ticket_resources` as an additional user. PostgreSQL rejects that row when the manager is already `tickets.assigned_to`, because the table constraint prohibits the assignee from also being an additional resource. A failed statement inside the escalation transaction can leave the transaction aborted, so catching the error does not preserve prior or later writes.

## Requirements

- `ensureEscalationManagerOnTicket` returns one of `already_assignee`, `existing_resource`, or `added`.
- A manager who is the ticket assignee receives no `ticket_resources` row.
- An existing additional resource is not inserted again; escalation remains idempotent on retry/re-run.
- All paths that attach escalation managers honor the same assignee/resource constraint.
- Resource-attachment failure cannot roll back `escalated` / `escalation_level`, the `ticket_escalated` audit row, or manager notification. Transaction boundaries must ensure an expected resource error cannot leave the PostgreSQL transaction aborted while those effects are being written.
- DB-backed behavioral coverage verifies manager-equals-assignee escalation, persisted escalation fields and audit, no prohibited resource row, notification delivery, and retry/re-run idempotency including notification behavior.
- The live “Review 2687 Failure Surfacing” manager-equals-assignee repro is reserved for the later running-app verification step; Draft Implementation must not start the app server.

## Scope and verification

Preserve the current SLA implementation and make only repairs needed for the current mitigation. Review `packages/sla/src/services/escalationService.ts`, every other escalation-manager attachment path, and the DB-backed tests before changing application code. Run focused behavioral checks and relevant package typechecks/builds only if application code changes are necessary. Report any material unmet implementation requirement clearly; do not claim the live repro without running it in its authorized app-verification step.
