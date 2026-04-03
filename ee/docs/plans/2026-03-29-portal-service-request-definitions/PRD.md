# PRD — Portal Service Request Definitions

- Slug: `portal-service-request-definitions`
- Date: `2026-03-29`
- Status: Draft

## Summary

Add a new customer-portal feature that lets MSPs define reusable service request experiences for authenticated client users. A service request definition is a tenant-owned, versioned object that combines portal presentation metadata, a schema-driven request form, optional linkage to the existing service catalog, and a submission execution mode.

The feature should be framed as a service catalog experience in the client portal, but its execution model should be workflow-first. In practice, each service request definition can submit through one of three modes:

- create a ticket only
- start a workflow only
- create a ticket and start a workflow

The easy path is a ticket-only preset. Templates are only shortcuts that create normal editable service request definitions; they are not a separate feature tier or special object type.

The implementation must preserve a clean physical separation between community and enterprise code. CE should own the service request host platform, storage model, portal experience, basic form behavior, and ticket-only execution. EE should extend CE through provider registries for workflow execution, advanced form behavior, advanced visibility rules, and richer template packs.

## Problem

MSPs need a structured, repeatable way for client users to request common services through the customer portal, especially during onboarding and lifecycle events such as:

- new hire setup
- access requests
- hardware and software requests
- employee offboarding
- standard operational intake that today becomes unstructured tickets or ad hoc email

The current product has useful building blocks but no unified feature for this job:

- the client portal has ticket submission and appointment request flows
- the workflow system has a form registry, inline forms, and human-task infrastructure
- the billing domain already has a service catalog that models commercial offerings

Those pieces do not yet add up to a client-facing, reusable service request platform. Ticket creation alone is too limited because it does not capture structured intake or execution flexibility. Workflow forms alone are too internal because they are designed for human tasks and workflow execution, not for published portal services. The service catalog alone is too billing-oriented because it models what is sold, not how a portal request is authored, published, versioned, and fulfilled.

Without this feature, MSPs either:

- force users into generic tickets
- build inconsistent manual processes outside the product
- or cannot operationalize onboarding and recurring service intake in the portal

## Goals

- Let MSP admins create service request definitions from scratch.
- Let MSP admins optionally start from built-in templates that become normal editable definitions.
- Expose a new `Request Services` area in the client portal for authenticated client users.
- Allow each request definition to be optionally linked to an existing `service_catalog` item.
- Persist a durable submission record for every request before downstream execution begins.
- Support a CE ticket-only path that is useful on its own.
- Support EE workflow-enabled execution without contaminating CE codepaths.
- Reuse the existing workflow `DynamicForm` renderer and related schema infrastructure where it fits, without making workflow forms the product-facing domain model.
- Preserve historical accuracy through immutable published versions so submissions remain tied to the exact definition and form that was presented at submission time.
- Provide a physical extension architecture where CE owns the host feature and EE plugs in additional capabilities through registries/providers.

## Non-goals

- Building a drag-and-drop visual document-designer experience for form authoring in v1.
- Reusing invoice/quote template AST layout tools as the primary form authoring model.
- Replacing the existing client portal ticket flow.
- Replacing appointment requests in v1.
- Collapsing portal service requests into `service_catalog`, `workflow_form_definitions`, or `workflow_tasks`.
- Multi-step forms in v1.
- Computed fields in v1.
- Embedded approval workflows inside the form itself in v1.
- A public unauthenticated form builder or internet-facing form publishing model.
- Quote generation, pricing acceptance, or contract-signing flows inside the initial request submission experience.
- New observability platforms, rollout machinery, or feature-flag work beyond normal product patterns.

## Users and Primary Flows

### 1. MSP admin creates a service request definition from scratch

- Admin navigates to a new MSP-side `Service Requests` area under client portal / portal administration.
- Admin creates a draft request definition.
- Admin defines the portal-facing metadata, optional category, optional linked service catalog item, and request form.
- Admin chooses the execution mode.
- Admin previews the client-facing request experience.
- Admin publishes the definition, creating an immutable version visible to the portal.

### 2. MSP admin creates a definition from a template

- Admin selects a starter template such as `New Hire`, `Access Request`, or `Hardware Request`.
- The system creates a normal draft definition prefilled with form fields, optional linked service, and suggested execution settings.
- Admin edits the result freely and publishes it.

### 3. Client user browses and submits a request

- Authenticated client user enters `Request Services` from the client portal navigation.
- User sees published service request cards grouped by category and filtered by visibility rules.
- User opens a service request, completes the form, and submits it.
- The system validates the submission against the published version snapshot.
- The system writes a durable submission record, then runs the configured execution provider.
- User sees a confirmation and can later view request history.

### 4. Easy path: ticket-only request

- Admin chooses the CE built-in `ticket-only` execution provider.
- On submit, the system creates a normal portal-backed ticket using configured defaults and mapped request data.
- The created ticket is linked back to the submission and visible in request history.

### 5. Workflow-enabled request

- Admin chooses an EE workflow provider.
- On submit, the system launches the configured workflow with mapped request data, optionally alongside ticket creation.
- The submission stores the workflow execution reference and remains the source-of-truth intake artifact.

### 6. MSP reviews submissions

- Admin opens a definition and reviews submissions tied to that definition.
- Admin can inspect who submitted the request, what values were submitted, when it was submitted, and what execution references were created.

## UX / UI Notes

### MSP-side authoring

The authoring surface should feel like publishing a service, not authoring a workflow.

Recommended editor sections:

- Basics
  - name
  - description
  - icon
  - category
  - sort order
- Linkage
  - optional `service_catalog` link via searchable picker
- Form
  - simple field builder in CE
  - preview
  - template-based starting points
- Execution
  - execution provider selection
  - provider-specific settings
- Publish
  - validation summary
  - current draft vs published version

Templates should be presented as shortcuts, not as a privileged authoring mode.

### Portal-side experience

Add a first-class `Request Services` top-level navigation item in the client portal alongside the current core tabs.

Recommended portal surfaces:

- Service catalog / landing page
  - grouped cards
  - icon, title, description
  - category grouping
- Request detail page
  - service description
  - form renderer
  - submit button
- Confirmation page / state
  - request ID
  - created ticket link when applicable
- My Requests
  - list of past submissions
  - detail view for a specific submission

The request form should use a schema-driven renderer and look native to the existing client portal rather than feeling like an internal workflow task view.

## Requirements

### Functional Requirements

#### Core feature host

- The system must introduce a new tenant-owned domain for portal service requests rather than overloading `service_catalog`, `workflow_form_definitions`, or `workflow_tasks`.
- CE must own the core host platform, including storage, portal routes, admin routes, definition lifecycle, and built-in providers needed for a coherent CE experience.
- EE must extend the host platform through registries/providers rather than direct CE branching at every call site.

#### Definition lifecycle

- Admins must be able to create a service request definition from scratch.
- Admins must be able to create a definition from a template.
- Definitions must support draft, published, and archived states.
- Publishing must create an immutable version snapshot.
- Admins must be able to create a new draft from the currently published state.
- Historical submissions must remain bound to the published version that was used during submission.

#### Portal metadata and taxonomy

- Definitions must support portal-facing name, description, icon, category, and sort order.
- Definitions may optionally link to an existing `service_catalog` row.
- The catalog link must be first-class in the model and admin UX, but it must remain optional.
- Templates may prefill linked-service information, but the created definition must remain fully editable.

#### CE form authoring and rendering

- CE must support a constrained form builder with these field types:
  - short text
  - long text
  - dropdown/select
  - checkbox
  - date
  - file upload
- CE form fields must support:
  - label
  - help text
  - required flag
  - static default value when appropriate
- Admins must be able to add, remove, and reorder fields.
- The system must persist a neutral, versionable schema model for the form.
- Portal rendering must use the published snapshot, not the mutable draft.

#### Portal browse and submit

- The client portal must expose a `Request Services` area for authenticated client users.
- Only published, visible definitions may appear in the portal catalog.
- Users must be able to open a request, complete the form, and submit it.
- Submit-time validation must run against the published definition snapshot.
- The system must persist a durable submission record before downstream execution begins.
- Users must be able to view their own request history and request details.

#### CE execution

- CE must ship one built-in execution provider: `ticket-only`.
- The ticket-only provider must support configuration for default ticket routing metadata such as board/category/priority/status where those concepts are needed by the existing ticket creation path.
- The provider must map request form payload into the created ticket payload.
- Successful ticket creation must update the submission with the created ticket reference.
- Failed ticket creation must leave the submission persisted and marked with an execution-failure state.
- CE must provide a simple ticket-only preset so admins do not need workflow knowledge to launch the feature.

#### Service catalog linkage

- Admins must be able to search and select a linked `service_catalog` item through an existing-style picker/search experience.
- Definitions without a linked service must still be publishable and usable.
- Definitions with a missing or invalid linked service must fail publish validation.

#### Submission history

- The platform must expose submission history for portal users scoped to their client ownership.
- The platform must expose submission history for MSP admins within the definition management surface.
- Submission details must show the captured request payload and downstream references such as ticket ID and workflow execution ID when present.

#### EE extension model

- EE must be able to register additional execution providers through a single enterprise entrypoint.
- EE must be able to register advanced form-behavior providers.
- EE must be able to register advanced visibility providers.
- EE must be able to register richer template packs.
- Provider-specific config must live in provider-keyed config blobs rather than EE-only schema columns.

#### EE execution and advanced behavior

- EE must support a `workflow-only` execution provider.
- EE must support a `ticket-plus-workflow` execution provider.
- EE must support mapping request submission data into workflow inputs.
- EE must support conditional show/hide field behavior.
- EE must support requester/client/context-aware defaults.
- EE must support advanced visibility rules beyond the CE default.

### Non-functional Requirements

- The feature must be physically separable between CE and EE.
- CE codepaths must remain buildable and coherent when EE is absent.
- The primary domain tables must live in CE and remain independent from workflow and billing storage models.
- Provider resolution must happen through stable registries/interfaces rather than through ad hoc `isEnterprise()` branching scattered throughout the feature.
- Portal request submissions must be durable and auditable even when downstream execution fails.
- Existing ticket, appointment, billing, and workflow experiences must remain behaviorally unchanged unless the new feature is actively used.

## Data / API / Integrations

### Proposed core tables

- `service_request_definitions`
  - tenant-owned mutable draft/config record
  - portal metadata
  - optional `category_id`
  - optional `linked_service_id`
  - provider keys/config blobs
  - lifecycle state
- `service_request_definition_versions`
  - immutable publish snapshots
  - version number per definition
  - published metadata + form snapshot + provider snapshot
- `service_request_submissions`
  - durable client submission record
  - definition/version references
  - requester/client/contact ownership data
  - submitted payload
  - status
  - ticket/workflow references
- `service_request_submission_attachments`
  - links between submissions and file/document storage references

### Core integrations

- Client portal routes/components
  - add a new request-services slice alongside tickets and appointments
- Client portal auth/scoping
  - reuse `withAuth(...)`
  - reuse the authenticated-client helper pattern already present in the client-portal package
- Service catalog
  - reuse catalog search/picker patterns
  - optional linkage only
- Ticketing
  - reuse existing portal ticket creation patterns for the CE provider
- Workflow/forms
  - reuse the existing `DynamicForm` renderer and schema concepts where appropriate
  - do not reuse workflow task tables as the core submission model
- EE execution
  - workflow launch is a provider integration target rather than the base domain model

### Proposed provider contract shape

CE should define neutral interfaces such as:

- `ServiceRequestExecutionProvider`
- `ServiceRequestFormBehaviorProvider`
- `ServiceRequestVisibilityProvider`
- `ServiceRequestTemplateProvider`
- optional `ServiceRequestAdminExtensionProvider`

Definitions and versions should persist provider keys plus opaque provider config, for example:

```json
{
  "execution_provider": "ticket-only",
  "execution_config": {
    "boardId": "..."
  },
  "form_behavior_provider": "basic",
  "form_behavior_config": {},
  "visibility_provider": "all-authenticated-client-users",
  "visibility_config": {}
}
```

## Security / Permissions

- MSP-side definition management must use explicit admin permissions for definition CRUD/publish/archive and submission review.
- Portal-side request access must be restricted to authenticated client users.
- Visibility enforcement must occur both when listing definitions and when submitting them directly.
- Submission history and attachment access must be scoped to the authenticated client/contact ownership model.
- Provider config validation must prevent malformed or unsupported EE config from being published.
- Linked ticket and workflow references exposed to portal users must respect existing client-visible access rules.

## Observability

- Reuse existing application logging and error handling patterns.
- Submission rows themselves provide the primary operational audit trail for this feature in v1.
- No net-new metrics, tracing, or monitoring platform work is required in this scope.

## Rollout / Migration

- This is a net-new feature with new tables; no backfill of existing tickets, appointments, or workflow tasks is required.
- Existing portal ticket creation and appointment requests remain unchanged.
- CE ships a complete, usable subset with ticket-only execution.
- EE adds capability by registering providers; no CE data migration should depend on EE being present.
- Starter templates may be seeded in code or data, but instantiation must always result in normal tenant-owned definitions.

## Open Questions

- MVP will ship per-definition submission review plus portal-side `My Requests`; it will not include an MSP-wide cross-definition submissions inbox.
- File-upload fields will reuse the existing document/file storage model, with `service_request_submission_attachments` acting as linkage metadata.
- Publish validation will block missing linked-service references and warn, but not block, when the linked service exists and is inactive.

## Acceptance Criteria (Definition of Done)

- MSP admins can create service request definitions from scratch and from templates.
- Templates behave only as starting points; the resulting definitions are normal editable tenant-owned records.
- Definitions support draft, publish, republish, and archive flows.
- The client portal exposes a `Request Services` area for authenticated client users.
- Published definitions render as native portal service requests and can be submitted successfully.
- Every submission persists a durable record before downstream execution begins.
- CE supports a complete ticket-only execution path, including request history and ticket linking.
- Definitions can optionally link to `service_catalog` without requiring the link.
- Historical submissions remain tied to immutable published versions.
- CE and EE remain physically separated through provider registries and guarded integration seams.
- EE can add workflow execution, advanced form behavior, advanced visibility, and richer templates without changing the CE domain model.
