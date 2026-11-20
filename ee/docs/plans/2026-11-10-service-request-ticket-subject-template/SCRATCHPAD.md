# Scratchpad: Service requests ticket subject template

- Plan slug: `service-request-ticket-subject-template`
- Created: `2026-11-10`
- Source: AlgaPSA ticket alga-2026-0002989
- Base: origin/main @ 88c634d5b5 (detached research checkout)

## Verified code facts

Checked against main at 88c634d5b5. Each item notes whether it matched the brief.

- `server/src/lib/service-requests/providers/builtins/ticketOnlyExecutionProvider.ts`
  - `renderTemplate()` (lines 15-26): regex `\{\{\s*([\w.-]+)\s*\}\}`. It inserts `String(value)` and renders null/undefined as `''`. **Matches the brief.**
  - `buildTicketTitle()` (lines 40-70): tries `titleTemplate` (used if non-empty after trim), then `titleFieldKey` (string values only), then the first non-empty string in `Object.values(payload)`, then `Service Request ${definitionId.slice(0, 8)}`. **Matches.** No whitespace collapsing and no length cap on any branch.
  - `buildTicketDescription()` writes `key: String(value)` lines using raw **keys**, not labels. `descriptionPrefix` is inserted verbatim, with no placeholder rendering.
- How each field type reaches the payload, which settles the "unknown" render behavior. Source: the portal action `server/src/app/client-portal/request-services/[definitionId]/actions.ts:172-196` and `RequestServiceForm.tsx`.
  - short-text, long-text and select: the raw string from the form. A select gives the option **value**.
  - checkbox: a **boolean** (`'on' | 'true' | '1'` maps to true), so it rendered as `"true"`/`"false"`.
  - date: the `DatePicker` writes a hidden input from `toIsoDateString()`, a local-calendar `YYYY-MM-DD` with no time and no time zone (`''` when cleared).
  - file-upload: **never in the payload**. Files travel separately as `attachments` and are not passed to the execution provider, so `{{file_key}}` always rendered `''`.
  - **There is no multi-select field type.** `BasicFormFieldType` is short-text, long-text, select, checkbox, date and file-upload (`basicFormBuilder.ts:5-11`). The brief's "multi-select joined" has nothing to apply to. This **differs from the brief**.
  - Hidden answers (visibility rules) are dropped from the payload before execution (`submissionService.ts:302-314`).
- Select options written in the editor are `value:label` lines (`parseSelectOptionsText` in the editor page), so value and label often differ. Every starter template uses label == value.
- Starter templates (`starterTemplateProvider.ts` lines 88, 135, 192, 266, 326, 394) all set `titleTemplate`. A script confirmed that every token points to a real field key. The only non-text token is `hardware_type` (a select with label == value), so starter output does not change.
- The editor does not manage `titleTemplate`:
  - `editorHelpers.ts:3-14` lists the managed keys (it includes `titleFieldKey` and `descriptionPrefix`, not `titleTemplate`).
  - `buildTicketRoutingExecutionConfig` spreads the existing config (lines 61-63), then deletes the managed keys, so `titleTemplate` survives a save. **Matches.**
  - Editor page lines 1721-1746 hold the "Title Field Key" `Input` (free text, no picker) and the "Description Prefix" `TextArea`. **Matches** (now at 1721-1747).
  - The Ticket Routing panel renders only when `executionProvider === 'ticket-only'` (`isTicketOnlyExecution`). For `ticket-plus-workflow` the editor shows only the workflow panel, so ticket routing for that mode cannot be configured in the UI at all. **New finding.**
  - Field keys are shown to authors: each field card shows `type · <mono key>`. Keys cannot be changed after creation (only the label is editable), and fields can be removed.
  - The form field list is available as `getSchemaFields(data.form.schema)`.
- EE `ee/server/src/lib/service-requests/providers.ts`
  - `ticket-plus-workflow` calls `ticketOnlyExecutionProvider.execute(context)` and passes the context through. **Matches.**
  - **The workflow stub is confirmed.** `executeWorkflowSubmission()` never starts anything. It returns `succeeded` with `workflowExecutionId: wf_<workflowId>_<ticketId|submissionId>`. `simulateFailure` is a config flag. This is out of scope and noted in the PRD.
- Ticket title length:
  - `tickets.title` is `text`, nullable (initial schema `202409071803_initial_schema.cjs:248`). There is **no DB limit**.
  - `TicketModel` zod requires `min(1)` only (`shared/models/ticketModel.ts:50,68`).
  - The REST `createTicketFieldsSchema.title` is `.max(255)` (`server/src/lib/api/schemas/ticket.ts:141`), and `updateTicketSchema` derives from it. Decision: cap at 255.
  - `packages/tickets/src/lib/duplicateTitle.ts` claims "ticket schemas set none", which is wrong for REST. Leave it alone.
- Published versions snapshot `form_schema_snapshot` and `execution_config` (`definitionPublishing.ts:108-110`). Runtime reads them through `portalDetail.ts`, and `definitionDetail.formSchema` is the snapshot, so the template and the form always agree at runtime.
- `ServiceRequestExecutionContext` (`providers/contracts.ts:14-25`) has no form schema today. The only production caller of `execute()` is `submissionService.ts:463`. Tests that call `ticketOnlyExecutionProvider.execute` directly (`ticketOnlyProviderSavepoint.integration.test.ts`) build the context `as any`, so the renderer must tolerate a missing schema.
- Publish validation (`definitionValidation.ts`) calls `provider.validateConfig(config)` with **config only**. The form schema is available there as `definition.form_schema`, so cross-validating template tokens against fields belongs in `definitionValidation`, gated on `provider.executionMode`.

## Existing mechanisms reused (searched before designing)

- **Token engine:** `packages/tickets/src/lib/titleTokens.ts`, a generic and pure `{{token}}` engine already shared by recurring/template titles (`ticketTitleTokens.ts`) and batch duplicate (`duplicateTitle.ts`). Server code can import it as `@alga-psa/tickets/lib/titleTokens` (tsconfig path `@alga-psa/tickets/*` maps to `packages/tickets/src/*`). The provider already imports `@alga-psa/tickets/lib/itilUtils` the same way. `substituteTokens` throws on an unknown token. That suits author-time rendering, but a portal submission must never fail on it, so we add `listTokens()` and resolve every token ourselves.
- **Date formatting:** `ticketTitleTokens.ts` already formats calendar dates as floating UTC midnight with `Intl` and an `en` fallback (`resolveLocale`, `dueDateAsUtc`). Lift that into the engine as `formatCalendarDate` rather than writing a second copy.
- **Tenant locale:** `getTenantDefaultLocale(tenantId, 'internal')` in `packages/notifications/src/notifications/emailLocaleResolver.ts:132`. The recurring ticket generator uses it for title tokens. It opens its own `getConnection()`. Add an optional `knex` argument (23 call sites, all unaffected) so the provider reads on its transaction and does not take a second pool connection during a portal submission.
- **Yes/No:** `common.json` `yes`/`no` exist in every locale (en, de, fr, es, nl, it, pl, pt, sv checked). Read them with `getServerTranslation(locale, 'common')` from `@alga-psa/ui/lib/i18n/serverOnly`.
- **UI:** no shared token input exists in `@alga-psa/ui/components`. Searched for insert, placeholder, variable, token and merge field. Hand-rolled versions:
  - `packages/tickets/src/components/ticket/BatchDuplicateTicketDialog.tsx:242-254`: `insertToken` with caret insert and `Button size="xs"` chips.
  - `packages/tickets/src/components/cannedResponses/CannedResponseEditor.tsx:154`: merge-field chips into a BlockNote editor.
  - `ee/server/src/components/workflow-designer/mapping/WorkflowTextTemplateEditor.tsx`: `insertTextTemplateField` (completes a started `{{`), plus `useCaretIntent` and `WorkflowInsertFieldPicker`. This is the most complete version, but it lives in EE and is tied to workflow mapping types, so CE code cannot use it.
  - `packages/notifications/.../TemplateVariableReference.tsx`: a searchable dialog reference for email variables. It is too heavy and too email-specific.
  - `TicketTemplateEditor.tsx:543` and `RecurringTicketEditor.tsx:530` show tokens as help text only.
  - Decision: build `@alga-psa/ui/components/TemplateTokenInput` using the standard `Input`/`TextArea`, `Button` and `DropdownMenu`, porting the insertion semantics from `insertTextTemplateField`. Put LEVERAGE markers on the other sites. Do not migrate them in this PR.
- **RMM:** `shared/rmm/alerts/ticketCreator.ts:249` has yet another `{{key}}` renderer. Add a LEVERAGE marker that points at the token engine.

## Decisions

- **Locale and time zone for dates.** Dates are calendar dates (`YYYY-MM-DD` with no time), so no time zone conversion applies. They are formatted as floating UTC midnight, exactly like recurring `{{due_date}}`. The locale is the **tenant default locale**, not the requester's, because:
  - the ticket subject is a shared record read mostly by MSP technicians;
  - it should not change depending on which client user submitted;
  - recurring-ticket title tokens already use the tenant default locale.
  - The style is `dateStyle: 'long'` ("March 2, 2026"), the same as `{{due_date}}`.
- **Checkbox output** is localized Yes/No from `common`. Raw `true`/`false` reads as a bug in a subject.
- **The description prefix uses the same renderer.** It is the same author, the same placeholder vocabulary and the same need. Unlike the subject, it keeps line breaks and has no cap. The `key: value` answer summary is left alone because changing it alters every ticket's description; that is a follow-up.
- **Fold Title Field Key into the template.** `{{key}}` covers everything `titleFieldKey` does (the same answer, now formatted by type), and keeping two overlapping inputs that interact through a hidden precedence order confuses authors. The editor:
  - loads a legacy `titleFieldKey` as `{{key}}`;
  - removes `titleFieldKey` on save (it stays in the managed-keys list);
  - leaves the runtime `titleFieldKey` branch in place, because published versions snapshot their config and API-authored configs may still use it.
  - Edge case: if *both* keys are set and the template renders empty, the legacy fallback after re-save becomes the first answer instead of the `titleFieldKey` answer. Neither the editor nor the starters ever wrote both, so we accept this.
  - A legacy `titleFieldKey` that points at a missing field loads as an unknown token and must be fixed before saving. That surfaces a misconfiguration that already existed.
- **Empty render** means empty after whitespace normalization. Literal-only output, such as `"New Hire:"` when the token is blank, is not empty and is kept, as before. We do not try to tidy dangling separators.
- **Unknown tokens.** At author time (editor and publish) they are an error, following the token engine's philosophy that a typo must never reach a title. At runtime they render empty, so a submission still creates its ticket.
- **File-upload placeholders** count as unknown and are not offered in the menu. The provider never sees attachments, and including attachment names would mean widening the execution context for little value.
- **Cap the length at 255.** That is the REST create and update limit, so tickets created from service requests stay editable through the API. The cap applies to every branch, including the first-answer fallback (a long-text answer).
- **Publish-time token validation lives in `definitionValidation.ts`**, keyed on `executionMode ∈ {ticket-only, ticket-plus-workflow}`, rather than in a widened `validateConfig(config, ctx)` contract. Only this check needs the schema today, so widening the provider contract would be speculative.

## Gotchas

- i18next uses `{{…}}` interpolation too. Never put a literal `{{employee_name}}` in a locale string; pass tokens in as interpolation values. Existing examples are `TicketTemplateEditor.tsx:543` and `BatchDuplicateTicketDialog.tsx:194`.
- Clicking a `DropdownMenu` item blurs the input. `selectionStart`/`selectionEnd` survive the blur on a native input, but "the author never placed a caret" must still mean append. The EE `useCaretIntent` exists for exactly this; port its idea (track whether the user focused or clicked into the field) into `TemplateTokenInput`.
- The renderer module is imported by the editor client component, so it must not import knex, `@alga-psa/db` or server-only i18n. Keep the locale and yes/no resolution in the provider and pass them in as `format`.
- `getServerTranslation` is wrapped in React `cache`. Calling it from the provider during a server action is fine. Always pass the locale explicitly; without one it falls back to request-cookie detection, which is the requester's locale, not the tenant's.
- Sibling plans from the same day also touch `ServiceRequestDefinitionEditorPage.tsx`: `service-request-delete-unused-forms`, `service-request-ticket-number-display` and `service-request-portal-internal-data-leak`. Expect rebase conflicts in the editor page.
- After adding keys to `en/msp/service-requests.json`, translate them into the other locales and regenerate the pseudo-locales (`scripts/generate-pseudo-locales.cjs`). Run `scripts/validate-translations.cjs`.

## Commands / runbooks

- Unit: `cd server && npx vitest run src/test/unit/serviceRequestTicketTextTemplate.unit.test.ts src/test/unit/serviceRequestEditorHelpers.unit.test.ts`
- Integration (needs the test DB): `cd server && npx vitest run src/test/integration/serviceRequestTicketExecution.integration.test.ts src/test/integration/serviceRequestDraftPublishValidation.integration.test.ts`
- Token engine regression: `cd packages/tickets && npx vitest run src/lib/__tests__/titleTokens.test.ts src/components/QuickAddTicket.templateTitle.test.ts`
- UI component: `cd packages/ui && npx vitest run src/components/TemplateTokenInput.test.tsx`
- Manual smoke: Service Requests, open a ticket-only definition, Execution tab, Ticket Routing. Insert two fields into Ticket subject and save. Publish. Submit from the client portal and check the ticket subject.

## Links

- AlgaPSA ticket: alga-2026-0002989
- Key files:
  - `server/src/lib/service-requests/providers/builtins/ticketOnlyExecutionProvider.ts`
  - `server/src/lib/service-requests/providers/contracts.ts`
  - `server/src/lib/service-requests/submissionService.ts`
  - `server/src/lib/service-requests/editorHelpers.ts`
  - `server/src/lib/service-requests/definitionValidation.ts`
  - `server/src/app/msp/service-requests/ServiceRequestDefinitionEditorPage.tsx`
  - `packages/tickets/src/lib/titleTokens.ts`
  - `packages/tickets/src/lib/ticketTitleTokens.ts`
  - `packages/notifications/src/notifications/emailLocaleResolver.ts`
  - `ee/server/src/lib/service-requests/providers.ts`
