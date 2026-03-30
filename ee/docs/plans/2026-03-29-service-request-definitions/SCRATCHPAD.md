# Scratchpad — Client Portal Service Requests

- Plan slug: `service-request-definitions`
- Created: `2026-03-29`

## What This Is

Keep a lightweight, continuously-updated log of discoveries and decisions made while implementing this plan.

Prefer short bullets. Append new entries as you learn things, and also *update earlier notes* when a decision changes or an open question is resolved.

## Decisions

- (2026-03-29) Product frame is `Request Services` in the portal, backed by tenant-owned `service_request_definition` records rather than generic ticket forms.
- (2026-03-29) Templates are shortcuts only. MSPs must be able to author brand-new definitions from scratch, and template-derived definitions are ordinary definitions after creation.
- (2026-03-29) Execution architecture is workflow-centric at the platform level, but CE ships a first-class ticket-only preset as the easy path.
- (2026-03-29) Existing billing `service_catalog` should remain an optional linkage target, not the primary request-definition table.
- (2026-03-29) Existing workflow form infrastructure should be reused as a rendering/input primitive where useful, but request definitions remain the primary business object.
- (2026-03-29) CE/EE separation must be physical and provider-based. CE hosts the domain model and extension contracts; EE registers richer execution/form behavior/template providers.
- (2026-03-29) MVP should target the market middle: schema-driven forms with standard fields plus conditional show/hide and requester/client defaults in EE, rather than stopping at plain text boxes.

## Discoveries / Constraints

- (2026-03-29) The repo already has a workflow form registry and task inbox model under `ee/packages/workflows`, including schema-backed form retrieval and validation paths.
- (2026-03-29) `DynamicForm` exists in `ee/packages/workflows/src/components/workflow/DynamicForm.tsx` and already renders JSON Schema/UI Schema through RJSF, making it the natural v1 rendering foundation.
- (2026-03-29) Client portal already has a request-like surface in appointment requests with authenticated client-only server actions, request history, and optional ticket linkage in `packages/client-portal/src/actions/client-portal-actions/appointmentRequestActions.ts`.
- (2026-03-29) The existing `service_catalog` model in `packages/billing/src/models/service.ts` is strongly billing/commercially oriented (`billing_method`, rates, tax, SKU, vendor, cost, license metadata) and should not carry form/workflow lifecycle concerns.
- (2026-03-29) Existing CE/EE seams already use neutral helpers and dynamic imports, e.g. `server/src/lib/features.ts#getFeatureImplementation`, and enterprise-only route delegation patterns in `server/src/app/api/v1/extensions/*`.
- (2026-03-29) The repo also contains capability/registry style patterns in EE extension infrastructure such as `ee/server/src/lib/extensions/providers.ts` and `ee/server/src/lib/extensions/lib/gateway-registry.ts`, which support the proposed provider-based request architecture.
- (2026-03-29) The visual invoice/quote designer is AST/document oriented, not input-form oriented, so it is a poor primary authoring model for v1 service request forms.

## Commands / Runbooks

- (2026-03-29) Inventory workflow form/task inbox reuse:
  - `rg -n "workflow_form_definitions|workflow_task_definitions|registerFormAction|taskInboxActions|DynamicForm" ee/packages/workflows/src server/src shared/workflow/runtime`
- (2026-03-29) Inventory client portal request precedents:
  - `rg -n "appointment request|withAuth\\(|user_type !== 'client'" packages/client-portal/src server/src/app`
- (2026-03-29) Inventory service catalog scope and coupling risk:
  - `rg -n "service_catalog|service categories|billing_method|default_rate" packages/billing/src server/migrations docs/billing`
- (2026-03-29) Inventory CE/EE separation seams:
  - `rg -n "getFeatureImplementation|enterprise|provider|registry|capability" server packages ee --glob '!**/*.test.*'`

## Links / References

- Workflow form registry docs: `docs/workflow/form-registry.md`
- Inline forms docs: `docs/workflow/inline-form-example.md`
- Task inbox integration docs: `docs/workflow/task-inbox-integration.md`
- Billing/service catalog mental model: `docs/billing/billing_for_msps_with_alga_psa.md`
- Billing service catalog model: `packages/billing/src/models/service.ts`
- Client portal ticket actions: `packages/client-portal/src/actions/client-portal-actions/client-tickets.ts`
- Client portal appointment request precedent: `packages/client-portal/src/actions/client-portal-actions/appointmentRequestActions.ts`
- Dynamic form renderer: `ee/packages/workflows/src/components/workflow/DynamicForm.tsx`
- CE/EE helper seam: `server/src/lib/features.ts`
- EE extension capability patterns: `ee/server/src/lib/extensions/providers.ts`
- EE extension gateway registry seam: `ee/server/src/lib/extensions/lib/gateway-registry.ts`

## Open Questions

- Should request history visibility be submitter-only in v1, or client-wide when the contact has broader portal permissions?
- Should CE ship starter templates, or should templates begin as EE-only packaged content?
- Should linked `service_catalog` items be selectable from any active service, or filtered to service-only `item_kind = service` rows in MVP?
