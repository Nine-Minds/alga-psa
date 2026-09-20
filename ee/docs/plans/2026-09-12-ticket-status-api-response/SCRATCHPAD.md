# Scratchpad — Ticket status API response consistency

## Scope and decisions

- Planning assignment for alga-2026-0002374; no implementation in this assignment.
- The card description and active XO facts were read on 2026-09-12 (local date). Both PUT paths are in scope because they share the affected service.
- Prefer a tenant-scoped final row read inside the existing transaction after status-related writes, then apply the existing description renderer. This returns database values without duplicating closure policy in controllers.
- A narrow defect needs six feature items and five representative tests, rather than a padded general-purpose feature list.

## Code evidence

- `server/src/lib/api/controllers/ApiTicketController.ts`: `updateStatus()` calls `ticketService.update` and serializes its result with `createSuccessResponse`; `update()` calls the same service through `this.service.update`.
- `server/src/lib/api/services/TicketService.ts`: the first ticket update uses `returning('*')` and binds `ticket`. Later status handling writes `is_closed`, then `closed_at` / `closed_by`, but the method returns `withDescriptionHtml(ticket)` using the earlier snapshot.
- Both endpoints therefore share the stale-snapshot mechanism. This is source inspection, not a new runtime reproduction.
- Existing service behavior: open-to-closed sets closure timestamp and actor; closed-to-open clears both; closed-to-closed preserves closure metadata; unchanged status skips status handling.
- Board/status validation and `enforceTicketCloseRules` run before the first ticket write. Keep those gates and the transaction boundary intact.
- `packages/tickets/src/actions/ticketBundleUtils.ts` documents denormalized closure consistency but does not need modification for this response defect.
- The brief reports an already-correct `closed_by`. The service source can return an earlier snapshot of all closure fields; validate all three against the stored row without assuming the precise deployed trigger/version behavior.

## Implementation and validation entry points

- Service: `server/src/lib/api/services/TicketService.ts`.
- Controller: `server/src/lib/api/controllers/ApiTicketController.ts`.
- Existing DB fixture patterns: `server/src/test/integration/ticketStatusReadSurfaces.integration.test.ts` and `server/src/test/integration/ticketCloseRules.integration.test.ts`.
- Proposed regression file: `server/src/test/integration/api/ticketStatusResponse.integration.test.ts`.
- Use migrated isolated fixtures and real ticket/status queries; dependency mocks may isolate external event delivery but must not replace persistence.
- Card environment records port 3335 and compose project `alga-psa-local-test`; availability was not revalidated during planning. Do not run destructive migrations against a shared stack.
- Follow the integration-testing skill and the repository test configuration during implementation; record exact executed commands and evidence here then.
- Manual API smoke: close via each PUT, capture response, GET and compare; reopen and repeat. Check `is_closed` from PUT against GET `status_is_closed`, and compare closure metadata. Redact credentials from evidence.

## Workspace and handoff

- Pre-existing `package-lock.json` modification is unrelated and must be preserved.
- All checklist entries remain false. Plan validation is not implementation or runtime verification.
- Board advancement and approval remain with the XO/captain.
