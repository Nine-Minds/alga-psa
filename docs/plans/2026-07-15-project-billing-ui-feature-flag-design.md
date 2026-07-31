# Project Billing UI Feature Flag — Design

**Date:** 2026-07-15
**Status:** Approved
**Parent plan:** `ee/docs/plans/2026-07-15-project-billing/`

## Context

Project billing is implemented end to end, but its ambient UI should remain undiscoverable until the next release. The underlying data model, actions, APIs, jobs, events, notifications, invoice behavior, and direct-link workflows must remain active.

## Decision

Add a dedicated client-side boolean flag named `project-billing-ui`. It defaults to disabled and fails closed so hidden controls do not flash while PostHog loads or when evaluation fails.

The flag controls rendering only. It must not be evaluated in server actions, API routes, services, models, migrations, jobs, workflow publishers/subscribers, invoice generation, or authorization checks.

## Hidden ambient surfaces

When the flag is disabled:

- Project details hide the Billing view-switcher option, billed header bar, phase billing badges, billing-specific phase-completion toast/link, and project payment-warning banner.
- Task and time-entry screens hide project payment-warning banners.
- The Invoicing Hub hides the Project Billing tab trigger and ready-count badge.
- Project client-portal configuration hides the Show Billing control and its summary text.
- Client project details hide the embedded billing summary.

## Direct access

Direct feature URLs remain fully functional:

- `?view=billing` renders the complete project billing workspace.
- `?tab=invoicing&subtab=project-billing` renders the complete project billing review queue.

A persisted Billing view preference is not direct access. When the flag is disabled and the URL does not explicitly request Billing, the project falls back to Kanban.

To preserve direct Invoicing Hub access while hiding only its trigger, `CustomTabs` gains an optional `hideTrigger` field. Hidden-trigger tabs remain in the content collection and may still be selected through a controlled/default URL value.

## Implementation seams

- `ProjectDetail`: one hook controls switcher discovery, persisted-view fallback, phase badges, billing toast, and project warning.
- `ProjectInfo`: guard the billed bar render.
- `TaskForm` and `TimeEntryDialog`: guard payment-warning renders.
- `InvoicingHub`: keep URL parsing/content registration intact; hide only the project-billing trigger.
- `ClientPortalConfigEditor`: guard both the toggle and summary description.
- `ProjectBillingSummarySection`: return no UI while disabled.
- `CustomTabs`: distinguish trigger visibility from content availability.

Data fetching may remain unchanged where that produces the smallest patch. Avoiding an incidental client fetch is acceptable, but the callable action itself must remain ungated.

## Verification

- Flag disabled: every ambient surface above is absent.
- Flag enabled: all current project-billing UI remains visible.
- Flag disabled plus direct project URL: billing workspace renders and works.
- Flag disabled plus direct invoicing URL: review queue renders and works without a visible tab trigger.
- Flag disabled plus persisted Billing preference and no direct URL: project opens in Kanban.
- Relevant UI packages typecheck, focused component/contract tests pass, and the flag is documented in `docs/features/feature-flags.md`.
