# PRD — Service requests: ticket subject template with field placeholders

- Slug: `service-request-ticket-subject-template`
- Date: `2026-11-10`
- Status: Draft
- Source: AlgaPSA ticket alga-2026-0002989

## Summary

Let MSP admins set the subject of the ticket that a service request form creates, built from the submitted answers. An example is `New Hire for Employee: {{employee_name}}, {{start_date}}`. The runtime already reads a `titleTemplate` from the execution config, but the form editor has no way to set it, and the runtime puts raw values into the subject: select option *values* instead of their labels, and dates as `YYYY-MM-DD`.

This plan adds:

- a **Ticket subject** input to the editor's Ticket Routing panel, with an **Insert field** menu that lists the form's fields by label;
- validation of unknown field placeholders, in the editor and at publish;
- one shared renderer that formats each answer by field type and is used for both the subject and the description prefix.

The old **Title Field Key** setting becomes part of the template, and existing forms keep working.

## Problem

- The ticket routing panel (`ServiceRequestDefinitionEditorPage.tsx`) offers only a free-text "Title Field Key" (one raw field key, no picker) and "Description Prefix". `titleTemplate` can be set only by a starter template or a direct config write. The editor keeps an existing `titleTemplate` on save but cannot show or change it.
- The runtime's `renderTemplate()` (`ticketOnlyExecutionProvider.ts`) uses `String(value)`, so:
  - **select** answers show the option value. Editor-authored options are `value:label` pairs, so the value is often a slug like `laptop`, not `Laptop`.
  - **date** answers show `2026-03-02`.
  - **checkbox** answers show `true`/`false`.
  - **file-upload** fields are never in the payload, so they render empty.
  - **long-text** answers can put newlines into a subject.
- Unknown placeholders silently render empty. A typo or a deleted field produces a broken subject with no warning.
- Subjects have no length cap. `tickets.title` is `text`, but the REST create and update schemas cap `title` at 255. A long service request title would make a later REST update that sends the title back fail validation.

## Goals

1. Admins can author, see and edit the ticket subject template in the form editor. An Insert field menu lists the form's fields by label and inserts `{{key}}` at the caret.
2. Unknown placeholders (and file-upload placeholders) are flagged inline in the editor, block saving the routing config, and block publishing.
3. Placeholders render by field type:
   - text is trimmed;
   - a select shows its option label;
   - a date is a readable calendar date in the tenant's default locale;
   - a checkbox shows a localized Yes or No;
   - a missing or hidden answer renders empty.
4. One pure rendering module serves the subject and the description prefix. Both the ticket-only and the EE ticket-plus-workflow providers use it (ticket-plus-workflow delegates to the ticket-only provider).
5. A subject that renders empty falls back to the existing chain: legacy `titleFieldKey`, then the first non-empty text answer, then `Service Request <id8>`. Every final subject has its whitespace collapsed and is capped at 255 characters.
6. Existing forms behave the same. Already-published versions that use `titleFieldKey` keep working.

## Non-goals

- **The EE "workflow" execution modes.** This is a separate defect, recorded here but not fixed. `workflow-only` and `ticket-plus-workflow` in `ee/server/src/lib/service-requests/providers.ts` never start a workflow. `executeWorkflowSubmission()` checks the config and returns `status: 'succeeded'` with a made-up `workflowExecutionId` (`wf_<workflowId>_<ticketId|submissionId>`). It should get its own ticket and plan.
- Showing the Ticket Routing panel for `ticket-plus-workflow`. Today the panel renders only when `executionProvider === 'ticket-only'`. The workflow modes are stubs, so that is part of the workflow defect above. Their subject templates still render through the shared module, because the provider delegates.
- Changing the description's answer summary (`key: value` lines), for example to use labels and formatted values. It is the same formatter, but it changes every service request ticket's description. This is a follow-up.
- A live subject preview, conditional segments, or per-placeholder format options (such as a custom date pattern).
- Moving the other token-insertion UIs (batch duplicate, canned responses, workflow designer) onto the new input component. They get `LEVERAGE` markers instead.

## Users and Primary Flows

**MSP admin (service request author)**

1. Opens a service request definition, Execution tab, Ticket Routing Configuration.
2. In **Ticket subject**, types `New Hire for Employee: ` and then picks *Insert field → Employee Name*. `{{employee_name}}` is inserted at the caret. They type `, ` and insert *Start Date*.
3. If they type `{{employe_name}}`, an inline error reads "Unknown field: {{employe_name}}" and Save Ticket Routing is blocked until it is fixed.
4. Saves and publishes. Publish fails with an `Execution:` error if the template refers to a field that is not on the form, for example after the field was removed.

**Client portal requester**

1. Submits the form with Employee Name "Jane Doe" and Start Date 2026-03-02.
2. The created ticket's subject is `New Hire for Employee: Jane Doe, March 2, 2026`. In a `de` tenant it is `…, 2. März 2026`.

**Existing form with a legacy Title Field Key `request_title`**

- In the editor it shows as the template `{{request_title}}`. Saving routing stores `titleTemplate: "{{request_title}}"` and drops `titleFieldKey`.
- An already-published version, with the snapshotted config, still uses `titleFieldKey` at runtime until it is republished.

## UX / UI Notes

- Replace the "Title Field Key" `Input` with a full-width (`md:col-span-2`) **Ticket subject** field that uses a new standard component `TemplateTokenInput` (`@alga-psa/ui/components/TemplateTokenInput`):
  - single-line input, plus an **Insert field** button (outline, small) that opens the standard `DropdownMenu`;
  - menu items show the field **label**, with the key as muted secondary text. The editor field cards already show `type · key`, so keys are author-facing, not hidden IDs;
  - file-upload fields are not listed;
  - the menu is disabled with a hint when the form has no fields that can be inserted;
  - insertion goes at the caret and replaces any selection. A placeholder the author has started (`{{emp`) is completed rather than duplicated. With no caret, the token is appended;
  - helper text: "Answers are filled in when the request is submitted. Leave blank to use the first answer.";
  - the inline error lists unknown placeholders.
- The **Description prefix** `TextArea` gets the same Insert field menu. `TemplateTokenInput` supports a multiline variant through a `multiline` prop that renders the standard `TextArea`. It shows the same unknown-field error.
- Existing component searches (see SCRATCHPAD) found no shared token input in `@alga-psa/ui`. Three products hand-roll the same shape: `BatchDuplicateTicketDialog` (chips plus caret insert), `CannedResponseEditor` (merge-field chips) and EE `WorkflowTextTemplateEditor` (the most complete version: insert, completing a started `{{`, caret intent). `TemplateTokenInput` lifts that behavior into `@alga-psa/ui`; the other sites get `LEVERAGE` markers.
- All new strings go in `msp/service-requests` (editor) and `common` (`yes`/`no` already exist). Never put a literal `{{key}}` in a locale string, because i18next would interpolate it. Pass tokens in as interpolation values.
- Element ids follow the existing `service-request-ticket-*` pattern:
  - `service-request-ticket-subject-template`
  - `service-request-ticket-subject-template-insert`
  - `service-request-ticket-subject-template-insert-<key>`
  - `service-request-ticket-description-prefix-insert`

## Requirements

### Functional Requirements

**Shared renderer (`server/src/lib/service-requests/ticketTextTemplate.ts`, pure and client-safe)**

- Builds on the existing generic token engine `packages/tickets/src/lib/titleTokens.ts`, which uses the same `{{ token }}` grammar as recurring-ticket and batch-duplicate titles. Add a `listTokens(template)` export to that engine, so callers can resolve every token without the throw-on-unknown path.
- Lift the floating calendar-date formatter out of `ticketTitleTokens.ts` (`resolveLocale` and `dueDateAsUtc`) into the engine as `formatCalendarDate(ymd, locale, style)`. The recurring `{{due_date}}` token and service request dates then share one implementation.
- `getServiceRequestTemplateFields(formSchema)` returns `{ key, label, type }` for every field except file-upload, in form order. The editor menu and validation both use it.
- `findUnknownServiceRequestTemplateTokens(template, formSchema)` returns tokens that are not insertable fields, including file-upload keys.
- `renderServiceRequestTemplate(template, { formSchema, payload, format })`, where `format = { locale, yes, no }`:
  - `short-text` / `long-text`: the trimmed string;
  - `select`: the label of the matching option, or the raw value if no option matches;
  - `date`: a `YYYY-MM-DD` answer formatted as a floating calendar date in `dateStyle: 'long'` for the given locale. Anything that does not parse falls back to the raw string;
  - `checkbox`: `format.yes` / `format.no`;
  - a key that is missing from the payload (hidden by visibility, or not answered), an unknown token, or a file-upload token renders `''`. The runtime never throws.
  - Payload keys with no schema field (old test contexts) render `String(value)`.
- `normalizeTicketSubject(text)` collapses all whitespace runs, including newlines, to a single space and trims. If the result is longer than 255 characters it is cut at a code-point boundary to 254 characters plus `…`.

**Ticket-only provider**

- `buildTicketTitle()` uses the shared renderer. The chain is unchanged: template, then `titleFieldKey`, then the first non-empty string answer, then `Service Request <id8>`. `normalizeTicketSubject` applies to the result of whichever branch produced the subject. "Empty" means empty after normalization.
- `buildTicketDescription()` renders `descriptionPrefix` placeholders with the same renderer, keeping line breaks (no subject normalization). The answer summary is unchanged.
- The locale is the **tenant default locale**. It is resolved once per execution through `getTenantDefaultLocale(tenant, 'internal', knex)`, with a new optional `knex` argument so that it reads `tenant_settings` on the provider's transaction instead of taking a second pool connection. Yes and No come from `getServerTranslation(locale, 'common')`.
- `ServiceRequestExecutionContext` gains a `formSchema: Record<string, unknown>` field. `submissionService` passes `definitionDetail.formSchema`, the published version's snapshot, which matches the payload. EE `ticket-plus-workflow` passes the context through unchanged.

**Editor**

- `TicketRoutingConfigInput` replaces `titleFieldKey` with `titleTemplate`. `TICKET_ROUTING_EXECUTION_CONFIG_KEYS` adds `titleTemplate` and keeps `titleFieldKey`, so a save writes `titleTemplate` (when not blank) and always removes the legacy `titleFieldKey`.
- `resolveTicketSubjectTemplate(config)` in `editorHelpers.ts` returns `config.titleTemplate` if it is set, else `{{<titleFieldKey>}}` if a legacy key is set, else `''`. The editor uses it to load the field.
- Save Ticket Routing and Save All refuse to save routing while the subject template or description prefix has unknown tokens. Save Ticket Routing shows the inline errors and an error toast. Save All adds Ticket Routing to its failures list.

**Publish validation**

- `validateServiceRequestDefinitionForPublish` checks every definition whose execution provider's `executionMode` is `ticket-only` or `ticket-plus-workflow`. If `titleTemplate` or `descriptionPrefix` contains tokens not returned by `getServiceRequestTemplateFields(form_schema)`, it adds the error `Execution: Ticket subject uses unknown field(s): {{x}}` (or the description prefix equivalent). This check lives in publish validation, not in `provider.validateConfig`, because only publish validation has the form schema.

### Non-functional Requirements

- The renderer module must stay free of server imports, because the editor client bundle imports it.
- No migration. Config keys stay in the existing `execution_config` JSON.

## Data / API / Integrations

- `execution_config.titleTemplate` (string) is now editor-managed. `execution_config.titleFieldKey` is legacy: it is still read at runtime and removed on the next routing save. `execution_config.descriptionPrefix` may now contain placeholders.
- Published versions snapshot both `form_schema_snapshot` and `execution_config`, so templates and answers always agree at runtime.
- Starter templates (`starterTemplateProvider.ts`) already use valid `titleTemplate`s that point to real field keys (verified). Hardware request's `{{hardware_type}}` is a select whose labels equal its values, so its output is unchanged.

## Security / Permissions

No change. The editor actions already require service request admin permissions. Rendering uses only the submitter's own visible answers, because hidden fields are dropped from the payload before execution.

## Rollout / Migration

- No feature flag and no data migration.
- Behavior changes for existing published forms:
  - select placeholders now show labels;
  - dates are human-readable;
  - checkboxes read Yes/No;
  - subjects have collapsed whitespace and a 255-character cap. This includes the first-answer fallback, which could previously put a whole long-text answer into the subject.
- Drafts whose existing template or description prefix uses an unknown placeholder will now fail publish validation until fixed. This is intended.

## Open Questions

None. Scope was decided upstream; the decisions and their reasons are in SCRATCHPAD.

## Acceptance Criteria (Definition of Done)

- An admin can set `New Hire for Employee: {{employee_name}}, {{start_date}}` from the editor using the Insert field menu. A portal submission then creates a ticket titled `New Hire for Employee: Jane Doe, March 2, 2026` (`en` tenant).
- A select placeholder renders the option label, not the value.
- An unknown placeholder shows an inline editor error, blocks the routing save, and fails publish validation.
- A legacy form with only `titleFieldKey` loads in the editor as `{{key}}`, and its published version still titles tickets from that field.
- Subjects never contain newlines and never exceed 255 characters.
- The description prefix supports the same placeholders.
- The existing service request execution, editor helper and template instantiation tests pass (updated only where the config shape changed intentionally).
