# Project Billing Hardening — Implementation Plan

**Design:** `docs/plans/2026-07-15-project-billing-hardening-design.md`
**ALGA checklist:** `ee/docs/plans/2026-07-15-project-billing/`

## 1. Schema and lifecycle boundary

- Add `requires_payment_before_work` with type/schema/model serialization.
- Remove the schedule transition trigger and make fresh/applied migrations converge.
- Centralize the allowed transition map and prevent status mutation through generic model updates.
- Update real-DB and action lifecycle tests.

## 2. Structured action contracts

- Add shared project-billing action result/error helpers.
- Convert config, schedule, warning, and standalone generation entry points.
- Update every UI caller to guard structured failures.
- Preserve safe unfinalize reasons for single and bulk handlers.

## 3. Payment-warning projection and UI

- Implement minimal and billing-detail warning projections.
- Add the explicit checkbox to schedule entry authoring.
- Render warning-only signals on project, task, and time-entry surfaces.
- Verify permission redaction and non-blocking behavior.

## 4. Events, workflows, and notifications

- Add event schemas and publisher registration.
- Register all project-billing events in the workflow catalog.
- Publish config/schedule/payment lifecycle events after commit.
- Detect the first persisted write-down and publish budget-exceeded once.
- Add localized email/internal notification templates and routing.

## 5. Invoice drawer and permission gates

- Extract a reusable invoice preview drawer from the contract implementation.
- Replace project invoice navigation and generation redirects with the drawer.
- Reuse client-portal billing permission checks for project billing summary.
- Retain server-side internal billed-header/invoice access checks.

## 6. Currency and economics

- Carry project currency through the portal summary and use ISO minor units.
- Return cost currency/mismatch metadata from project economics.
- Format costs in tenant reporting currency and explain unavailable margin.
- Add EUR, JPY, mixed-currency, and effective-cost-rate coverage.

## 7. Internationalization

- Add new warning/event/error/drawer/economics strings.
- Replace project-billing English fallbacks in real locales.
- Remove hardcoded USD/date/locale presentation.
- Regenerate pseudo-locales and validate all locales.

## 8. Verification and plan close-out

- Run focused unit, contract, integration, typecheck, and locale suites.
- Run comprehensive browser smoke tests against the live worktree environment.
- Restore test fixtures and check server/browser logs for regressions.
- Flip implemented flags only for completed features/tests and record commands/results in `SCRATCHPAD.md`.
