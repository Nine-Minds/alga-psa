# Scratchpad — Client portal service requests: remove debug and internal data

- Plan slug: `service-request-portal-internal-data-leak`
- Created: `2026-11-10`
- Source: AlgaPSA ticket alga-2026-0002989
- Sibling card: `service-request-ticket-number-display`
  (`ee/docs/plans/2026-11-10-service-request-ticket-number-display/`). It owns the
  Request ID / Ticket ID GUID display and the success banners.

## Verified code facts (checked against origin/main at 88c634d5b5)

- **Form page** (`server/src/app/client-portal/request-services/[definitionId]/page.tsx`)
  - Lines 156-167 render an "Initial Values" `<section>` with
    `<pre>{JSON.stringify(detail.initialValues, null, 2)}</pre>`, or `detail.noInitialValues`
    when empty. Confirmed.
  - **Not in the brief:** line 78 also renders `t('detail.version', { version: detail.versionNumber })`
    in the header. It is the same internal authoring-version data as the detail page's
    "Version N", so this plan removes it too.
- **EE context defaults** (`ee/server/src/lib/service-requests/providers.ts`)
  - `advancedFormBehaviorProvider.resolveInitialValues` (~lines 215-231) replaces
    `{{requesterUserId}}`, `{{clientId}}` and `{{contactId}}` inside `contextDefaults`
    string values. Confirmed.
  - `portalDetail.ts` merges these over the static defaults into `initialValues`.
- **Prefill still needed**
  - `RequestServiceForm` seeds its value state from `initialValues`, including non-field
    keys. The shared visibility evaluator reads that state.
  - Server-side `resolveSubmissionVisibility` evaluates over `{ ...detail.initialValues, ...payload }`.
  - So `initialValues` must keep flowing to the form unchanged. Only the debug section
    goes.
  - The context UUIDs in `initialValues` are the requester's own IDs. The browser already
    gets them through `getRequestServiceVisibilityContextAction`, by design.
- **Stored payload**
  - The submit action builds `payload` from snapshot field keys only (`[definitionId]/actions.ts`
    ~166-195), and the stored value is `visiblePayload`. So context defaults are not stored
    in `submitted_payload`.
  - The no-fields fallback therefore only matters for legacy or empty-schema submissions.
- **Definition detail action**
  - `getRequestServiceDefinitionDetailAction` returns the full
    `ServiceRequestPortalDefinitionDetail`, including `executionProvider`,
    `executionConfig`, `formBehaviorConfig`, `versionId`, `versionNumber` and
    `visibleFieldKeys`. **Not in the brief.**
  - The page uses only title, description, icon, versionNumber, formSchema, initialValues,
    and formBehaviorProvider/Config, which it uses to parse visibility rules.
  - The submit action and `submitPortalServiceRequest` call
    `getVisiblePublishedServiceRequestDefinitionDetail` directly, so narrowing the action
    does not affect submission.
- **Submission detail page** (`my-requests/[submissionId]/page.tsx`, 207 lines)
  - Line 85: `executionStatus` with the raw `execution_status`. Confirmed.
  - Line 88: `versionLabel` with `definition_version_number`. Confirmed.
  - Lines 101-105: `workflowLabel` with `workflow_execution_id`. Confirmed.
  - Lines 110-113: the `<pre>JSON.stringify(payload)</pre>` fallback when the snapshot has
    no fields. Confirmed.
  - Attachments in answers (~134-143):
    - They show `file_name ?? file_id`, plus a "(file_id)" suffix when the name exists.
    - So the file ID shows in both cases, not only in parentheses.
  - The Attachments section (~166-169) also falls back to `file_id` as the name, and then
    has the `fileIdLabel` line.
  - History (181-204) uses `defaultValue: event.operation`, so untranslated operations
    render as raw snake_case. Confirmed.
- **History source**
  - `listServiceRequestSubmissionAuditEvents` (`submissionHistory.ts` ~107-158) selects
    every `audit_logs` row for the submission, with no operation filter. Confirmed.
  - Admin `getServiceRequestSubmissionDetailForDefinition` shares it.
- **Operation union** (`submissionAudit.ts` 22-28) has six operations. Confirmed.
  - `submissionService.ts` writes:
    - `created` (~383)
    - `execution_succeeded` (~152), with details `{ execution_provider }`
    - `execution_failed` (~172), with **details `{ error_summary: <raw message> }`**
  - `mapping/applyEngine.ts` writes:
    - `mapping_field_applied` / `mapping_field_failed` (~458). changedData has
      `target_field_key`, `before_value` and `after_value`; details have
      `destination_kind`, `resolved_target_ref`, `status` and `error_code`. The actor is
      the MSP user.
    - `mapping_applied` (~768). Details have `mapping_version_id` and the counts.
- **Additional leak channel, not in the brief:**
  - The client DTO's audit events carry `details` and `user_id`. For `execution_failed`,
    `details.error_summary` is the raw exception text, and the mapping events carry
    internal refs.
  - The page does not render these fields, but they are in the action's return value.
    That is why FR4 narrows the event shape, not just the operation list.
- **Client DTO** also carries `execution_error_summary`, `definition_id` and
  `definition_version_id`. The page does not render them.
- **`workflow_execution_id` format.** The brief said `wf_<id>_<uuid>`. Precisely:
  - `buildWorkflowReference` makes `wf_<workflowId>_<createdTicketId>` when a ticket
    exists, else `wf_<workflowId>_<submissionId>` (`providers.ts` ~106-108).
  - `stripe_session_<checkoutSessionId>` comes from `providers.ts` ~355 and
    `ee/server/src/lib/actions/applianceLicenseActions.ts` ~164.
- **Dashboard** (`packages/client-portal/src/actions/client-portal-actions/dashboard.ts`)
  - The select at ~443-452 includes `execution_error_summary`. Confirmed.
  - The mapping at ~526-532 sets `description: s.execution_error_summary || ''`. Confirmed.
  - `RecentServiceRequestActivityRow` (~100-105) declares the field.
- **Raw error source.** The brief gave no directory for `ticketOnlyExecutionProvider.ts`;
  the file is at `server/src/lib/service-requests/providers/builtins/ticketOnlyExecutionProvider.ts`.
  Lines ~258-262 return `errorSummary: error.message`. Confirmed.
- **ClientDashboard** (`packages/client-portal/src/components/dashboard/ClientDashboard.tsx`)
  - It uses the `client-portal` namespace.
  - Titles resolve through `activityTitleKey`, as
    `dashboard.activity.titles.<type>.<status>` with `_default`.
  - The description renders raw at ~610-613.
  - The `service_request.failed` title already reads "Service request failed: {{name}}".
- **Status labels**
  - `myRequests.statuses.{pending,succeeded,failed}` already exist in every locale.
  - `MyRequestsTable` maps the tones succeeded = success, failed = error, else warning
    with inline ternaries (~70-84).
- **Locales:** de, en, es, fr, it, nl, pl, pt, sv, plus the pseudo-locales xx and yy.
  - `npm run test:i18n` = `generate-pseudo-locales.cjs` + `validate-translations.cjs`
    (key parity) + the `tools/i18n` audits.
  - No `tools/i18n` ledger references the keys being removed.

## Existing tests that encode the old behavior (must update)

- `packages/client-portal/src/components/layout/serviceRequestsI18n.integration.test.ts:16`:
  `t('detail.noInitialValues')`.
- `server/src/test/unit/app/client-portal/request-services/myRequestDetail.page.test.tsx:116-122`:
  "renders the immutable captured form version" asserts "Version 1". The fixtures include
  `user_id` and `details`.
  - An earlier plan deliberately added the version line. The real guarantee is that answers
    render against the captured snapshot, which stays and is covered at the data layer
    by `serviceRequestVersionIntegrity`.
- `serviceRequestWorkflowExecution.integration.test.ts:399`:
  `clientDetail.workflow_execution_id`. Assert absence; keep the admin assertion at 407.
- `serviceRequestVersionIntegrity.integration.test.ts:192`: `detail.definition_version_id`.
  Assert through the version-1 `form_schema_snapshot` (fields already checked below it).
- `serviceRequestStoreOnlySubmission.integration.test.ts:510, 515-519, 619`: client
  `definition_version_number` and `event.user_id`. Move to `actor_name` and keep the admin
  checks.
- `serviceRequestPortalHistory.integration.test.ts:201-209`: attachment `file_id`.
- `[definitionId]/page.test.tsx`, `my-requests/[submissionId]/page.test.tsx`: mock
  fixture shapes.
- `portalServiceRequestToTicket.journey.integration.test.ts:482/518`: reads only
  `created_ticket_id` (kept), so no change is needed.

## Decisions

- **Narrow at the data layer, not in the JSX.** The client DTO types drop the internal
  fields, so a future view edit cannot render them; the TypeScript build fails instead.
- **The audience lives on the audit operation catalog**, a `Record` keyed by operation. That
  forces each new operation to declare client visibility at compile time, which closes this
  class of leak for future audit events. The client read path passes the allow-list as a SQL
  filter. There is no "client mode" flag: the filter is a plain `operations` predicate.
- **Fail closed.** Operations not on the allow-list (legacy or future) are excluded.
- **Status vocabulary.** Reuse `myRequests.statuses.*` and the `Badge` so the list and the
  detail page agree. A status → tone/label helper replaces `MyRequestsTable`'s inline
  copy. That would otherwise have been a second copy, a `LEVERAGE: pattern` case, and the
  extraction is trivial.
- **No-fields fallback.** Synthesize `{ key, label: key }` fields from the payload and
  reuse the normal row path, instead of a second rendering branch.
- **Dashboard generic message.** It is a translated, status-keyed description lookup that
  mirrors the existing title-key mechanism (`descriptions.<type>.<status>`, empty default).
  This avoids a service_request special case in the view.
  - The copy follows the portal's existing "contact your service provider" phrasing.
- **Form version** is removed from the form page header as well as the detail page. Both
  show the same internal concept.
- No status hint on the detail page for failures. That would be new copy and was not
  requested.

## LEVERAGE notes

- `// LEVERAGE: friction portal-dto-by-spread`: the client portal queries build DTOs as
  `{ ...row }` over a select list shared in spirit with admin queries. The portal then
  depends on JSX discipline to hide internals. This plan fixes the two service request DTOs.
  If other portal DTOs show the same shape (tickets, projects), a "portal projection" layer
  per entity is the candidate. Drop the marker at `getClientServiceRequestSubmissionDetail`
  when implementing.
- `submissionFieldPresentation.ts` hardcodes "Yes"/"No" for checkboxes. This is i18n debt,
  and out of scope.
- `requestServiceSubmitErrorMessage` (`[definitionId]/actions.ts` ~57-79) returns
  hardcoded English through the `?error=` URL param, and passes the raw validation message
  through ("Please fix the form: ..."). It is adjacent to this bug but out of scope. A
  candidate follow-up.

## Commands / Runbooks

- Unit:
  `cd server && npx vitest run src/test/unit/app/client-portal/request-services "src/app/client-portal/request-services"`
- Portal package:
  `cd packages/client-portal && npx vitest run src/actions/client-portal-actions/dashboard src/components/layout/serviceRequestsI18n.integration.test.ts`
- Integration (needs DB):
  `cd server && npx vitest run src/test/integration/serviceRequestPortalHistory.integration.test.ts src/test/integration/serviceRequestStoreOnlySubmission.integration.test.ts src/test/integration/serviceRequestWorkflowExecution.integration.test.ts src/test/integration/serviceRequestVersionIntegrity.integration.test.ts`
- i18n: `node scripts/generate-pseudo-locales.cjs && node scripts/validate-translations.cjs`
  (or `npm run test:i18n`)

## Manual smoke

- EE tenant: an advanced-provider definition with `contextDefaults` referencing
  `{{clientId}}`. Open the form as a client user and confirm there is no Initial Values
  section and the prefill works.
- Apply an answer mapping as an MSP user. The client's submission History shows no mapping
  rows, and the MSP admin detail still shows them.
- Force a ticket-only failure, for example an invalid board in the execution config. The
  dashboard shows "Service request failed: <name>" plus the generic line and no exception
  text. The detail page shows a Failed badge.
- Check light and dark themes.

## Gotchas

- `git grep --include` needs quoting in zsh (`--include='*.ts'`).
- Merge order with the sibling card: both edit the `getClientServiceRequestSubmissionDetail`
  select list. Keep the sibling's `ticket_number` join, and keep `created_ticket_id`.
