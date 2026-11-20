# PRD — Client portal service requests: remove debug and internal data

- Slug: `service-request-portal-internal-data-leak`
- Date: `2026-11-10`
- Status: Draft
- Source: AlgaPSA ticket alga-2026-0002989
- Type: Bug. There is no setting or toggle. Internal data is removed for every tenant.

## Summary

Client portal users see developer and internal data on the service request pages and on the
dashboard. This includes a raw JSON dump of form defaults that can contain the user's own
UUIDs, raw status enums, form version numbers, internal workflow execution IDs, file IDs, a
JSON dump of answers, MSP-only answer-mapping audit rows with the technician's name, and raw
exception text.

The fix applies one rule: **the client portal renders only client-facing fields.** It is
enforced where the data is shaped, not just where it is drawn:

- The portal queries and server actions return client-safe DTOs. Internal fields never
  reach portal pages or the browser.
- The view then renders those DTOs with the same components and translated labels the
  portal already uses.

## Problem

Three surfaces are affected.

**1. Request form page** (`server/src/app/client-portal/request-services/[definitionId]/page.tsx`)

- An "Initial Values" section renders `<pre>{JSON.stringify(detail.initialValues)}</pre>`, or
  "No static defaults configured." when there are none.
  - With the advanced form-behavior provider (EE), `initialValues` includes context
    defaults resolved from `{{requesterUserId}}`, `{{clientId}}` and `{{contactId}}`
    (`ee/server/src/lib/service-requests/providers.ts`, `resolveInitialValues`). The dump
    therefore shows the signed-in user's own internal UUIDs.
- The header shows "Version N". That is the definition's authoring version, an MSP concept.
- `getRequestServiceDefinitionDetailAction` returns the full
  `ServiceRequestPortalDefinitionDetail` to the page. That includes `executionProvider`,
  `executionConfig` (MSP routing configuration), `formBehaviorConfig`, `versionId` and
  `visibleFieldKeys`, none of which the page renders. The action is a `'use server'`
  export, so its return value is a client-reachable contract.

**2. Submission detail page** (`server/src/app/client-portal/request-services/my-requests/[submissionId]/page.tsx`)

- "Execution status: {{status}}" prints the raw enum (`pending` / `succeeded` / `failed`).
  The list page already renders the same value as a translated badge.
- "Version N" prints the captured definition version number.
- "Workflow: {{id}}" prints `workflow_execution_id`. That value is internal and synthetic:
  `wf_<workflowId>_<ticketOrSubmissionId>` from the EE workflow stub, or
  `stripe_session_<id>` from the EE checkout provider.
- When the form snapshot has no fields, "Submitted Answers" falls back to
  `<pre>{JSON.stringify(payload)}</pre>`.
- Attachments show internal file IDs: "(file_id)" next to the name in the answers,
  `file_id` as the name when the file has no name, and a "File ID: <uuid>" line in the
  Attachments section.
- History renders every `audit_logs` row for the submission
  (`listServiceRequestSubmissionAuditEvents`, unfiltered). This includes MSP-only
  answer-mapping operations from `mapping/applyEngine.ts`:
  - `service_request_submission_mapping_applied`
  - `service_request_submission_mapping_field_applied`
  - `service_request_submission_mapping_field_failed`

  They have no translation, so they appear as raw snake_case, attributed to the MSP
  technician who applied the mapping.
- The client DTO also carries internal data the page does not render today:
  - each history event's `details` and `user_id`. The `execution_failed` event's
    `details.error_summary` is the raw exception text. The mapping events' `details`
    carry resolved target references and before/after values.
  - `execution_error_summary`, `definition_id` and `definition_version_id`.

**3. Client dashboard recent activity** (`packages/client-portal/src/actions/client-portal-actions/dashboard.ts`)

- Service request activity selects `execution_error_summary` and uses it as the activity
  description. For the ticket-only provider, that is the raw `error.message` from whatever
  threw during ticket creation (`ticketOnlyExecutionProvider.ts`). A client can see a
  database or validation exception string.

## Goals

1. No client portal service request surface renders an internal ID, raw enum, JSON dump,
   raw error message or MSP-only audit event.
2. The portal data layer returns client-safe DTOs: internal fields are absent from the
   objects, not just hidden in JSX.
3. History is filtered by an allow-list declared next to the audit operation catalog. Each
   operation must declare whether clients can see it, and the code does not compile until it
   does. Unknown or legacy operations are hidden.
4. Form prefill and visibility-rule behavior are unchanged.

## Non-goals

- **"Request ID" and "Ticket ID" GUID display.** This covers the success banner on the
  catalog and definition pages, the "Request ID" line under the detail page heading, and the
  ticket line in the detail page's Status section. The sibling card
  `service-request-ticket-number-display` (plan
  `ee/docs/plans/2026-11-10-service-request-ticket-number-display/`) owns these. This plan
  does not edit those lines, the `submitted`/`ticketId` search params, the success banner
  markup, or the `requestIdLabel` / `ticketIdLabel` / `ticketLabel` locale keys.
- MSP-side (admin) submission views. They are for internal users and keep every field and
  every audit event.
- Changing what the audit trail records. Mapping events are still written; they are only
  withheld from the client DTO.
- Changing the submit-error banner text (`requestServiceSubmitErrorMessage`). That is a
  separate i18n and copy issue, recorded in the scratchpad.
- Localizing the "Yes"/"No" checkbox display in `submissionFieldPresentation.ts`. This is
  existing i18n debt, recorded in the scratchpad.
- A new, friendlier vocabulary for statuses. The detail page reuses the list page's existing
  translated labels, so the two pages agree.

## Users and Primary Flows

- **Client portal user** opens Request Services and then a request form. They see the title,
  description, icon and form. There is no defaults dump and no version.
- **Client portal user** opens My Requests and then a submission. They see:
  - the submitted date and a status badge (the same badge as the list)
  - their answers as label/value rows
  - attachments by file name
  - a history of client-meaningful events only: submitted, processing completed,
    processing failed
- **Client portal user** views the dashboard. A failed service request shows "Service request
  failed: <name>" with a generic, translated "contact your service provider" line. No
  exception text is shown.

## UX / UI Notes

- **Status:** render with the standard `Badge` (`@alga-psa/ui/components/Badge`). Use the
  existing `myRequests.statuses.*` labels and the same tones as `MyRequestsTable`
  (succeeded = success, failed = error, pending = warning). The section heading "Status"
  already labels it, so no "Execution status:" prefix is needed.
- **Answers fallback** (snapshot has no fields): render the payload as the same `<dl>` rows
  used for snapshot fields. Use the payload key as the label. Values pass through the same
  display function.
- **Attachments:** show the file name. When the name is missing, show the translated
  generic label "Attachment". Never show the file ID. Keep the existing "Type: <mime>" line.
- **History:** translated operation label, timestamp and actor, as today, over the filtered
  event list.
- **Form page:** remove the "Initial Values" section and the header's "Version N". The icon
  stays.
- **Dashboard:** when the server sends no description, the activity row shows the optional
  translated description for its type and status
  (`dashboard.activity.descriptions.<type>.<status>`). This is the same lookup shape as the
  existing `dashboard.activity.titles.<type>.<status>`. Only
  `service_request.failed` gets a string in this change.
- Check light and dark themes. No new colors are introduced, since the badge tones already
  exist.

## Requirements

### Functional Requirements

**Audit operation catalog (`server/src/lib/service-requests/submissionAudit.ts`)**

- FR1: Replace the bare `ServiceRequestSubmissionAuditOperation` union with a catalog object.
  - Each operation maps to its audience, `'client'` or `'internal'`. The object is typed
    `satisfies Record<string, { audience: ... }>`.
  - Derive the operation type from the catalog's keys.
  - Export `CLIENT_VISIBLE_SUBMISSION_AUDIT_OPERATIONS` (and its type), derived from the
    catalog.
  - The `created`, `execution_succeeded` and `execution_failed` operations are `client`.
    The three `mapping_*` operations are `internal`.
- FR2: `listServiceRequestSubmissionAuditEvents` accepts an optional
  `operations: readonly string[]`.
  - When given, the filter is applied in SQL (`whereIn('operation', operations)`).
  - Without it, behavior is unchanged, so the admin detail still gets every event.

**Client submission detail DTO (`server/src/lib/service-requests/submissionHistory.ts`)**

- FR3: `getClientServiceRequestSubmissionDetail` loads history with
  `operations: CLIENT_VISIBLE_SUBMISSION_AUDIT_OPERATIONS`. Operations missing from the
  allow-list (mapping, legacy, future) are excluded.
- FR4: The client history event type is a new `ServiceRequestClientSubmissionHistoryEvent`
  with only `audit_id`, `operation` (the client-visible operation type), `actor_name` and
  `timestamp`. There is no `user_id` and no `details`.
- FR5: Remove these fields from both `ServiceRequestClientSubmissionDetail` and its `select`:
  - `workflow_execution_id`
  - `execution_error_summary`
  - `definition_id`
  - `definition_version_id`
  - `definition_version_number`

  Keep `submission_id`, `request_name`, `submitted_payload`, `execution_status`,
  `created_ticket_id`, `submitted_at` and `form_schema_snapshot`. The version join stays,
  because it supplies `form_schema_snapshot`.
- FR6: Client attachments use a new `ServiceRequestClientSubmissionAttachment` with
  `submission_attachment_id`, `field_key`, `file_name` and `mime_type`. `file_id`,
  `file_size` and `created_at` are not selected.
  - `submissionFieldPresentation.ts` keys attachments by `submission_attachment_id`
    instead of `file_id`.

**Submission detail page**

- FR7: Status renders as a `Badge` with the translated `myRequests.statuses.*` label.
  - The status → tone + label mapping moves into one small helper next to the request
    services pages. `MyRequestsTable` and the detail page both use it, replacing
    `MyRequestsTable`'s inline ternaries.
- FR8: Remove the "Version N" line.
- FR9: Remove the "Workflow: <id>" line.
- FR10: When the snapshot has no fields, build display fields from the payload's keys
  (`{ key, label: key }`). Render them through the same `<dl>` row path and
  `getSubmissionFieldDisplay`. The `<pre>` JSON fallback is removed.
- FR11: In the answers and the Attachments section, show the attachment's `file_name`, or
  the translated `submissionDetail.unnamedAttachment` when it has none. Remove the
  "(file_id)" suffix and the "File ID:" line. React keys use `submission_attachment_id`.
- FR12: History labels come from `submissionDetail.historyOperations.<operation>`. The
  `defaultValue: event.operation` raw fallback is removed: the DTO type guarantees a key
  exists.

**Request form page**

- FR13: Remove the "Initial Values" section.
- FR14: Remove the header "Version N".
- FR15: Pass `initialValues` to `RequestServiceForm` exactly as today, so prefill and the
  browser-side visibility evaluator keep parity with the server.
- FR16: `getRequestServiceDefinitionDetailAction` returns a portal projection,
  `ServiceRequestPortalFormView`. A pure mapper `toPortalFormView(detail)` builds it in
  `portalDetail.ts`, and it has only these fields:
  - `title`, `description`, `icon`
  - `formSchema`, `initialValues`
  - `visibilityRules`: parsed server-side when the provider is `advanced`, otherwise `[]`

  The page no longer reads `formBehaviorProvider` / `formBehaviorConfig`.
  - `submitRequestServiceDefinitionAction` and `submitPortalServiceRequest` keep calling
    `getVisiblePublishedServiceRequestDefinitionDetail` directly and still get the full
    detail.

**Client dashboard**

- FR17: The service request activity query no longer selects `execution_error_summary`.
  `RecentServiceRequestActivityRow` drops the field, and the activity's `description` is
  `''`.
- FR18: `ClientDashboard` shows the server `description` when it is not empty. Otherwise it
  shows `t('dashboard.activity.descriptions.<type>.<status>', { defaultValue: '' })`, and
  renders nothing when that is empty.
  - Add `dashboard.activity.descriptions.service_request.failed`: "This request couldn't be
    processed. Contact your service provider for help."

**Locales**

- FR19: In `server/public/locales/*/client-portal/service-requests.json`, remove these keys
  from every locale:
  - `detail.version`
  - `detail.initialValuesTitle`
  - `detail.noInitialValues`
  - `submissionDetail.executionStatus`
  - `submissionDetail.versionLabel`
  - `submissionDetail.workflowLabel`
  - `submissionDetail.fileIdLabel`
- FR20: Add the new keys.
  - `submissionDetail.unnamedAttachment` ("Attachment") goes in
    `client-portal/service-requests.json`.
  - `dashboard.activity.descriptions.service_request.failed` goes in `client-portal.json`.
  - Translate both for de, es, fr, it, nl, pl, pt and sv.
  - Regenerate xx and yy with `node scripts/generate-pseudo-locales.cjs`.
  - `node scripts/validate-translations.cjs` must pass.

**Existing tests that encode the old behavior**

- FR21: Update the tests that asserted removed output or fields:
  - `packages/client-portal/src/components/layout/serviceRequestsI18n.integration.test.ts`:
    `detail.noInitialValues`
  - `server/src/test/unit/app/client-portal/request-services/myRequestDetail.page.test.tsx`:
    "Version 1", and fixtures with `details` / `user_id` / `file_id`
  - `server/src/test/integration/serviceRequestWorkflowExecution.integration.test.ts`:
    `clientDetail.workflow_execution_id`. Assert absence on the client detail; keep the
    admin assertion.
  - `server/src/test/integration/serviceRequestVersionIntegrity.integration.test.ts`:
    `detail.definition_version_id`. Assert through the version-1 `form_schema_snapshot`
    instead.
  - `server/src/test/integration/serviceRequestStoreOnlySubmission.integration.test.ts`:
    `clientDetail.definition_version_number` and `event.user_id` on client events. Keep the
    admin-side assertions.
  - `server/src/test/integration/serviceRequestPortalHistory.integration.test.ts`:
    attachment `file_id`.
  - `[definitionId]/page.test.tsx` and `my-requests/[submissionId]/page.test.tsx`: fixture
    shapes.

### Non-functional Requirements

- No hardcoded user-facing strings. Use interpolation. Follow `docs/AI_coding_standards.md`
  i18n rules.
- Use standard components first: `Badge` for status. No bespoke status chip.
- Narrowing is enforced by types. If a portal page tries to read a removed field, the
  TypeScript build fails.

## Data / API / Integrations

- No schema change and no migration.
- `audit_logs` writes are unchanged. Only the client read path filters by operation.
- Admin read paths are unchanged:
  - `getServiceRequestSubmissionDetailForDefinition`
  - `listServiceRequestSubmissionsForDefinition`
  - `getServiceRequestSubmissionHistoryDetail`
- Changed public types in `server/src/lib/service-requests`:
  - `ServiceRequestClientSubmissionDetail` is narrowed.
  - `ServiceRequestClientSubmissionHistoryEvent`, `ServiceRequestClientSubmissionAttachment`
    and `ServiceRequestPortalFormView` are new.
  - Re-export the new types from `server/src/lib/service-requests/index.ts`.

## Security / Permissions

- No permission model change. The existing `withAuth` + `isClientUserType` +
  `getAuthenticatedClientId` scoping stays as is.
- This is defense in depth on a client-reachable contract. Today the pages are server
  components, so unrendered fields mostly stay on the server. But the actions are
  `'use server'` exports, and the next view edit could render any field the DTO carries.
  Removing the fields from the DTO closes both paths.

## Observability

None.

## Rollout / Migration

- No flag and no migration. The change ships for every tenant.
- **Merge coordination with sibling card `service-request-ticket-number-display`:**
  - In `my-requests/[submissionId]/page.tsx`, this plan does not touch:
    - the "Request ID" paragraph under the `<h1>`
    - the `created_ticket_id` ticket paragraph in the Status section

    This plan edits the execution-status, version and workflow lines, the answers, the
    attachments and the history.
  - In `[definitionId]/page.tsx`, the sibling removes the success banner and the
    `submitted`/`ticketId` search params. This plan removes the "Initial Values" section,
    the header version line, and the page's reads of `formBehaviorProvider` /
    `formBehaviorConfig`. These are separate hunks.
  - In `submissionHistory.ts`, both plans edit the select list of
    `getClientServiceRequestSubmissionDetail`. The sibling adds a ticket join and
    `ticket_number`; this plan removes five columns. Expect a trivial textual conflict.
    Keep `ticket_number` and `created_ticket_id` in the narrowed DTO.
  - In the locale files, the two plans touch disjoint keys.
  - In `MyRequestsTable.tsx`, the sibling changes the ticket column and this plan changes
    the status column.

## Open Questions

None. The scope was decided upstream.

## Acceptance Criteria (Definition of Done)

1. The request form page shows no "Initial Values" section and no version. Fields prefilled
   from static or context defaults are still prefilled.
2. The submission detail page shows:
   - a translated status badge that matches the list page
   - no "Execution status", "Version" or "Workflow" lines
   - answers as label/value rows even when the snapshot has no fields
   - attachments by name, or "Attachment" when unnamed
   - no file IDs and no `{`/JSON blocks
3. History on the client detail lists only submitted / processing completed / processing
   failed events. Mapping events, and any operation not on the allow-list, never appear in
   the client DTO. The MSP admin detail for the same submission still lists every event.
4. `getClientServiceRequestSubmissionDetail` returns no `workflow_execution_id`,
   `execution_error_summary`, `definition_id`, `definition_version_id`,
   `definition_version_number`, event `details` / `user_id`, or attachment `file_id`.
5. `getRequestServiceDefinitionDetailAction` returns no execution provider or config, no
   form-behavior config, and no version identifiers.
6. A failed service request on the dashboard shows the translated generic message and never
   exception text. The dashboard query does not select `execution_error_summary`.
7. `node scripts/validate-translations.cjs` passes. The removed keys are gone from every
   locale, and the new keys exist in every locale.
8. The updated unit and integration suites pass.
