# PRD — Client Portal Service Requests

- Slug: `service-request-definitions`
- Date: `2026-03-29`
- Status: Draft

## Summary

Add a first-class **service request definition** system for the customer portal so MSPs can publish reusable services such as `New Hire`, `Access Request`, `Hardware Request`, `Software Install`, and `Employee Offboarding`. A portal user can browse those services, complete a structured request form, and submit the request into the MSP's downstream process.

The product language is service-oriented, not workflow-oriented. Each definition owns:
- portal metadata
- a structured form
- an execution mode
- optional linkage to an existing billable `service_catalog` item

Execution must support:
- ticket-only
- workflow-only
- ticket-plus-workflow

Templates are shortcuts only. MSPs must be able to author new service definitions from scratch, and there must be nothing structurally special about platform-provided templates beyond prefilling normal definition fields.

The architecture must keep CE and EE physically separated. CE provides the neutral host platform, definition/submission lifecycle, portal UX, basic field authoring, and ticket-only execution. EE plugs in workflow execution, advanced form behavior, richer visibility targeting, and template packs through explicit provider/registry seams instead of `if enterprise` branching scattered through the feature.

## Problem

MSPs want customers to request common services through the client portal using structured, repeatable forms rather than freeform ticket submission. The strongest demand is around onboarding and lifecycle processes:
- new hire onboarding
- offboarding
- access requests
- hardware requests
- software/license provisioning

Today the customer portal can create tickets and submit appointment requests, and the workflow system can render schema-driven forms for human tasks, but there is no productized way to publish reusable requestable services to customers.

Without this feature:
- MSPs force structured operational requests through generic ticket forms, email, or manual back-and-forth.
- Request quality is inconsistent because required fields vary by technician or requester.
- Portal self-service is weaker than competing PSA/ITSM offerings that expose request types or service catalogs.
- Automation opportunities are lost because intake is not modeled as a first-class service request object.

## Goals

- Let MSP admins create **service request definitions** from scratch or from templates.
- Let portal users browse and submit those service requests from a dedicated `Request Services` experience.
- Make templates normal starting points, not a distinct implementation path.
- Support structured forms with a constrained but useful schema-driven authoring experience.
- Persist durable submission records before downstream execution so requests are auditable and retryable.
- Support three execution modes:
  - ticket-only
  - workflow-only
  - ticket-plus-workflow
- Allow each definition to be optionally linked to a `service_catalog` item in a first-class way.
- Reuse existing workflow-form rendering infrastructure where sensible, without making workflow form records the top-level business object.
- Reuse existing client portal auth, routing, and action patterns.
- Preserve physical CE/EE separation via provider-style extension seams.
- Ship a CE slice that is independently valuable, while reserving the highest-automation capabilities for EE.

## Non-goals

- Replacing the existing ticket create flow for generic ad hoc issues.
- Turning `service_catalog` into the primary request-definition table.
- Reframing service requests as user activities or human tasks in the portal UI.
- Building a drag-and-drop WYSIWYG form/page designer for v1.
- Shipping multi-step forms in v1.
- Shipping computed fields, approvals-in-form, or repeatable nested sections in v1.
- Adding pricing, quoting, or contract enforcement to portal requests in v1.
- Building a new generic workflow form system separate from the existing schema-driven renderer.
- Adding broad rollout, feature-flag, metrics, or observability work beyond what is minimally necessary for the feature to function safely.

## Users and Primary Flows

### 1. MSP admin creates a service request definition

- Admin navigates to a new `Service Requests` area.
- Admin creates a definition from blank or from a platform template.
- Admin enters the service card metadata shown in the portal.
- Admin optionally links the definition to an existing `service_catalog` record.
- Admin authors a form using a constrained field builder.
- Admin selects execution mode and downstream routing.
- Admin previews the requester experience.
- Admin saves draft changes and publishes a version.

### 2. Portal user browses requestable services

- Client user opens `Request Services` in the portal.
- User sees published service cards grouped by category.
- User opens a service detail page or drawer.
- User reads service description/instructions and completes the request form.
- User submits the request and sees a confirmation state.

### 3. Platform records and executes the request

- System validates the submission against the published definition version.
- System writes a durable `service_request_submission` record first.
- System runs the configured execution adapter:
  - create ticket
  - start workflow
  - create ticket and start workflow
- System stores execution results and surfaced status on the submission record.

### 4. Portal user reviews previous requests

- User opens a request history screen.
- User sees status, service name, submitted date, and any linked ticket where applicable.
- User can open a request detail view for the submitted payload and downstream references that the portal is allowed to expose.

### 5. MSP admin manages lifecycle

- Admin edits draft definitions.
- Admin publishes a new immutable version.
- Admin archives a definition so it no longer appears to new requesters.
- Existing submissions remain tied to the version that created them.

## UX / UI Notes

### Portal IA

- Add a new top-level client portal area: `Request Services`.
- Present request definitions as service cards, not as raw forms or workflows.
- Support category grouping and search/filtering only if it materially improves the MVP; category grouping is more important than search at launch.
- Service detail should show:
  - name
  - description
  - optional linked commercial service context
  - form
  - success/confirmation language

### Admin IA

- Add a new MSP admin area distinct from the existing billing `service_catalog` screens.
- Service request definitions should not be edited inside service catalog CRUD because the data model and mental model are different.
- The admin authoring flow should feel like:
  1. define the service
  2. define the form
  3. define what happens on submit
  4. publish

### Form Authoring

- Use a constrained field builder, not the invoice/quote document designer.
- The field builder should target schema-driven forms backed by the existing workflow form renderer contract.
- Templates must populate normal definition data and remain editable as ordinary definitions.
- Basic CE field types for MVP:
  - short text
  - long text
  - dropdown/select
  - checkbox
  - date
  - file upload

### Product language

- Use `Service Request` and `Request Services` in UI copy.
- Avoid surfacing workflow jargon to portal users.
- Avoid treating the request definition as a billing service in the admin UI, even when linked to `service_catalog`.

## Requirements

### Functional Requirements

#### Domain model and lifecycle

- Introduce a new tenant-owned domain object: `service_request_definition`.
- A definition must support draft, published, and archived lifecycle states.
- Publishing must create an immutable version snapshot.
- Submissions must always reference the exact published definition version used at submission time.
- Definitions must support an optional link to a `service_catalog` row.
- Definitions created from templates must be ordinary editable definitions after creation.

#### Portal requester experience

- Portal users must be able to browse published request definitions visible to them.
- Portal users must be able to open a request definition and complete its form.
- Portal submissions must validate required fields and supported file uploads before persistence.
- Portal users must receive a confirmation state after successful submission.
- Portal users must be able to review a history of their own submitted service requests.
- Portal request detail must expose downstream references only when those references are otherwise visible to the client user.

#### Admin authoring experience

- MSP admins must be able to create definitions from scratch.
- MSP admins must be able to create definitions from templates.
- MSP admins must be able to edit metadata, form fields, and execution configuration in draft.
- MSP admins must be able to preview portal rendering before publishing.
- MSP admins must be able to publish new versions and archive old definitions.
- MSP admins must be able to duplicate existing definitions.

#### Form model

- The service request form model must be schema-driven.
- The primary business object must remain `service_request_definition`; workflow form rows may be used as implementation detail but not as the main user-facing domain model.
- CE must support a constrained basic builder for common field types.
- EE may add richer form behavior via registered providers.
- Platform templates and form rendering must support static defaults.
- EE must support conditional show/hide and context-aware defaults through enterprise form behavior providers.

#### Execution

- Submission must create a durable `service_request_submission` record before executing downstream actions.
- CE must ship a built-in ticket execution adapter.
- The ticket execution path must support a simple/easy preset so admins can avoid workflow authoring.
- EE must be able to register workflow execution and ticket-plus-workflow execution adapters.
- Execution results must be recorded on the submission so the request can surface status and references later.
- Execution failures must not erase the submission record.

#### CE / EE extension architecture

- CE must own the neutral domain tables, core actions, portal experience, admin shell, and extension contracts.
- CE must not depend on EE implementation details.
- EE features must register through explicit extension seams such as execution providers, form behavior providers, visibility providers, admin extension panels, and template providers.
- CE must behave coherently even when no EE providers are installed.

#### Service catalog linkage

- Linking a request definition to a `service_catalog` item must be normal and discoverable in the authoring UI.
- The link must remain optional.
- Linked service context must be available to downstream ticket and workflow execution adapters.
- The system must not require every request definition to be billable or immediately monetized.

#### Request history and status

- A portal user must be able to see their prior submissions.
- A submission must expose enough normalized metadata to render history without replaying downstream systems.
- If a ticket is created and visible to the requester, the portal should offer navigation to that ticket.
- Workflow execution details may be abstracted behind a simplified request status rather than exposing raw workflow internals.

### Non-functional Requirements

- Preserve physical separation between CE and EE code.
- Keep CE domain contracts stable and neutral so enterprise providers can evolve without schema churn in CE.
- Reuse existing client portal auth and server action patterns instead of introducing a separate API stack by default.
- Prefer adapting existing schema-driven form rendering infrastructure over introducing a second form runtime.
- Ensure published request-definition versioning prevents historical submissions from becoming ambiguous after edits.
- Keep the execution pipeline idempotent enough that retries can be reasoned about at the submission level.

## Data / API / Integrations

### Proposed core records

#### `service_request_definitions`

Tenant-owned authoring record for:
- name
- slug/key
- description
- category
- icon/visual metadata
- publish/archive state
- optional `service_catalog_id`
- portal visibility mode
- execution mode/provider key
- execution config blob
- form behavior mode/provider key
- form schema / ui schema / builder config
- confirmation copy

#### `service_request_definition_versions`

Immutable published snapshots of:
- effective metadata
- effective form config
- effective execution config
- provider keys used at publish time
- publish metadata

#### `service_request_submissions`

Durable request record for:
- definition id + definition version id
- requester user id / contact id / client id
- normalized submitted payload
- derived status
- created ticket id, workflow run id, or both
- execution outcome / error summary
- timestamps

#### `service_request_submission_attachments`

Optional attachment metadata join table if uploads are stored separately from payload JSON.

### Existing systems to reuse

- Client portal auth/routing/action patterns in `packages/client-portal`
- Existing portal request precedent in appointment requests
- Existing `service_catalog` / `service_categories` for optional commercial linkage
- Existing workflow form renderer contract and task inbox form schemas when useful as rendering primitives
- Existing workflow runtime in EE for workflow execution providers

### Existing systems not to overload

- `service_catalog` must not become the primary definition table.
- `workflow_form_definitions` must not become the primary business object exposed to admins.
- Invoice/quote AST document designer should not be repurposed as the v1 form-authoring model.

### Integration directions

- CE should provide a request execution registry with built-in `ticket-only` provider.
- EE should register `workflow-only` and `ticket-plus-workflow` providers.
- CE should provide a form behavior registry with built-in `basic` provider.
- EE should register `advanced` behavior providers for conditional logic and context-aware defaults.
- CE should provide a template registry contract; EE may add richer template packs while CE can ship starter templates or none.

## Security / Permissions

- Only authenticated client portal users may submit service requests through the portal.
- Portal visibility must respect tenant/contact/client context and published state.
- Portal request history must only expose submissions belonging to the current requester or otherwise intentionally shared visibility scope.
- MSP-only authoring actions must use existing MSP auth patterns and dedicated permissions.
- File uploads must follow the same storage/security model used by other portal-upload surfaces.
- Downstream workflow/ticket references shown in the portal must respect existing ticket/client visibility rules.

## Observability

This plan does not add broad observability or metrics scope beyond the minimum functional status persistence on submission records. Operational telemetry, dashboards, and analytics expansion can be planned separately if needed.

## Rollout / Migration

- Introduce new request-definition tables rather than mutating `service_catalog` into a dual-purpose table.
- Seed starter templates only if they are part of the agreed product scope; they should remain ordinary definition payloads.
- No destructive migration of existing portal ticket flows is required.
- Existing appointment request and ticket submission flows remain intact.
- New navigation entries should appear only when the feature surface is installed/configured for the edition.

## Open Questions

- Should portal request history be scoped only to the submitting contact, or optionally to all portal users for the same client?
- Should CE ship any built-in starter templates, or should templates begin as EE-only value-add content?
- Should archived definitions remain visible in admin lists indefinitely or support a harder delete after no submission references remain?
- How far should v1 go on category/search/filtering in the portal list?

## Acceptance Criteria (Definition of Done)

- MSP admins can create service request definitions from scratch.
- MSP admins can create definitions from templates, and the resulting definitions behave like normal editable definitions.
- Portal users can browse published request definitions in a dedicated `Request Services` area.
- Portal users can submit a structured request form and receive a confirmation state.
- Each submission persists a durable request record before downstream execution begins.
- CE supports a working ticket-only execution mode end-to-end.
- Definitions can optionally link to `service_catalog` items without requiring the linkage.
- Definition publishing creates immutable versions, and historical submissions remain tied to the version they were created from.
- Portal users can review their previous submissions and navigate to linked tickets when visible.
- EE capabilities plug in through explicit provider-style seams rather than scattered edition conditionals.
- Basic CE functionality remains coherent and useful when enterprise providers are absent.
