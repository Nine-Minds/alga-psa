# Plan: Email internal users and ticket assignees from a workflow

- **Ticket:** alga-2026-0002481 (CloudVBS, Lynda Gaiao)
- **Card:** b4b85679, "Workflow action: email internal users / ticket assignee"
- **Branch:** `feature/workflow-action-email-internal-users-ticket-assi` (base `origin/main` at `dc89552709`; no workflow or email-action drift since)

## 1. Problem

A workflow can only email literal addresses. `email.send` (`shared/workflow/runtime/actions/businessOperations/email.ts:48`) takes `to/cc/bcc: [{ email, name? }]`. No step turns a user id, a role or a ticket's assignees into addresses.

`notifications.send_in_app` (`businessOperations/notifications.ts:22`) already resolves `user_ids`, `role_ids` and `role_names`, but it only creates in-app notifications.

Lynda's 7-day "Waiting for client" workflow has to email the requester contact and the ticket's technicians. The contact part already works through a contact lookup mapped into `to`. The technician part has no path. `tickets.find` returns `assigned_to` (a user id, no address). Nothing exposes `ticket_resources`, so a ticket's additional resources can't be reached at all.

Every ticket trigger payload carries `ticketId` (`shared/workflow/runtime/schemas/ticketEventSchemas.ts`). Only the deprecated `assignedToUserId` on one event carries an assignee.

## 2. Decision: extend `email.send` (option a), built on a recipient resolver extracted from notifications

`email.send` gains internal-recipient inputs next to `to/cc/bcc`:

- users and roles, through the same recipient model as `notifications.send_in_app`
- a ticket whose assigned technician, or assigned technician plus additional resources, receive the email

These inputs resolve server-side to addresses. The resolution logic moves out of `notifications.ts` into one shared module that both actions call.

### Why this option

- **It reads naturally in the designer.** The author adds the step they already know, Send Email, and fills **Ticket** with the trigger's ticket. The designer's top-level auto-suggest offers `payload.ticketId` for a `ticket` picker field (`mapping/autoMappingSuggestions.ts`, `InputMappingEditor.tsx:2018`). Then the author picks *Assigned technician and additional resources*. There's no lookup step, no loop and no expression. One message can mix recipient kinds, for example "email the contact, Cc the technician", which is how ConnectWise notify actions work and what Lynda is replicating.
- **It reuses the send path.** Sender identity, mail class, templating, attachments, provider selection, retry and error mapping, idempotency and the recipient cap at `email.ts:185` all stay in one handler. A second action would duplicate that whole input surface and drift from it.
- **It earns a layer.** "Turn a recipient spec into users" now exists in `notifications.ts`, inline in its handler, and this card needs it a second time. That is the cue to extract a layer. The ticket-assignee source lands in that layer, so in-app notifications can adopt it later without new resolution code (see §9).

### Why not the other options

- **(b) A dedicated "Send email to user(s)" step.** It would copy subject, bodies, sender, mail class, attachments, provider and idempotency from `email.send`. It also can't combine the contact and the technician in one message, and it puts two near-identical email steps in the palette. Its one advantage, a recipient picker shaped like Send In-App Notification's, comes with option (a) through the shared editor (§4.2, step 8).
- **(c) A `users.find` action composed with `email.send`.** Emailing a ticket's assignees would take Find Ticket, a lookup of additional resources that doesn't exist, a loop over Find User, and an expression to build `[{ email, name }]`. That is the hand-wiring the card exists to remove. A general `users.find` may still be worth building, but not for this need.

## 3. Recipient-resolution contract

### 3.1 Shared resolver

New module: `shared/workflow/runtime/actions/businessOperations/userRecipients.ts`.

```ts
export const workflowUserRecipientsSchema = z.object({
  user_ids:   z.array(uuidSchema).optional(),    // picker 'user'
  role_ids:   z.array(uuidSchema).optional(),    // picker 'role'
  role_names: z.array(z.string().min(1)).optional() // case-insensitive
});

export type WorkflowTicketAssigneeScope = 'assigned' | 'assigned_and_additional';

export type WorkflowUserRecipientSpec = z.infer<typeof workflowUserRecipientsSchema> & {
  ticket?: { ticket_id: string; assignees: WorkflowTicketAssigneeScope };
};

export type ResolvedWorkflowUser = {
  user_id: string;
  email: string | null;
  display_name: string;          // "first last", trimmed; falls back to username
  user_type: 'internal' | 'client';
  is_inactive: boolean;
  sources: Array<'user' | 'role' | 'ticket_assigned' | 'ticket_additional'>;
};

export async function resolveWorkflowUserRecipients(
  tx: TenantTxContext, ctx: ActionContext, spec: WorkflowUserRecipientSpec
): Promise<ResolvedWorkflowUser[]>;
```

The resolver follows these rules:

1. **Tenant isolation.** Every query goes through `tenantDb(tx.trx, tx.tenantId)`: `users`, `roles`, `user_roles`, `tickets` and `ticket_resources`. An id from another tenant behaves exactly like an id that doesn't exist.
2. **Explicit `user_ids`.** An id with no `users` row in the tenant throws `ActionError NOT_FOUND`, "One or more users not found", with `details.missing_user_ids`. This keeps today's `send_in_app` behaviour: a picked user that is gone is a definition fault, so the step fails fast.
3. **Roles.** `role_ids` and `role_names` (case-insensitive, matched with `lower(role_name)`) expand to members through `user_roles`, as `notifications.ts` does today. An unmatched role contributes nobody and is not an error. That is also today's behaviour.
4. **Ticket.** The ticket is read through `tenantDb(...).table('tickets').where('ticket_id', …)`. If it's missing, the resolver throws `ActionError NOT_FOUND`, "Ticket not found", with `details.ticket_id`.
   - `assigned` resolves to `tickets.assigned_to`, when it is set.
   - `assigned_and_additional` adds every non-null `ticket_resources.additional_user_id` for the ticket, in `assigned_at` order. This includes team-member rows written by team assignment.
   - A ticket with nobody assigned contributes nobody. That is not an error at this layer.
   - The additional-resources query reuses `getCurrentTicketAdditionalUserIds` (`tickets.ts:123`), with an `orderBy(assigned_at)` added. Export it, or move it next to the resolver.
5. **Dedupe by `user_id`.** The resolver merges `sources` and keeps first-seen order: ticket assigned, ticket additional, users, then roles.
6. **No status filtering.** The resolver returns inactive users, client users and users without an address, classified. Each caller applies its own delivery policy (§3.2, §3.3).

### 3.2 Email delivery policy

New function in the same module: `selectEmailableUsers(users) → { recipients: Array<{ user_id; email; name }>, skipped: Array<{ user_id; reason }> }`. It is pure.

| Condition | Result | Reason code |
|---|---|---|
| `is_inactive = true` | skipped | `inactive` |
| `user_type !== 'internal'` | skipped | `not_internal` |
| `email` null or blank | skipped | `no_email` |
| otherwise | recipient `{ email, name: display_name }` | n/a |

Skipped users don't fail the step. They are returned in the action output (§4.1) so later steps and Run Studio can see who was left out.

A pure `mergeEmailRecipients({ to, cc, bcc }, internal, placeAs)` builds the final lists:

- It places the internal recipients into `to`, `cc` or `bcc` according to `users_as`.
- It removes duplicate addresses case-insensitively across all three lists. Precedence is To, then Cc, then Bcc, so an address in To isn't repeated in Cc.
- It returns the final total.

### 3.3 In-app policy (unchanged)

`notifications.send_in_app` calls the same resolver. It keeps exactly today's semantics: every resolved user receives a notification, including inactive and client users. A regression test (T15) pins this. Changing it is a separate product decision (§9).

### 3.4 Email outcomes

- **Recipient cap.** The cap counts the merged, deduplicated To + Cc + Bcc after resolution. It is compared with `provider.capabilities.maxRecipientsPerMessage ?? 100`, which is today's rule, now applied to the real list. Over the cap, the step throws `ValidationError VALIDATION_ERROR`, "Too many recipients for email provider", with `details: { count, max }`. Nothing is truncated.
- **No recipients.** This happens when the merged total is 0, for example when the ticket is unassigned and no literal address was given. The new input `on_no_recipients` decides the outcome:
  - `error` (the default) throws `ActionError NO_RECIPIENTS`, "No one to email: …", naming which sources resolved empty.
  - `skip` returns `status: 'skipped'` and sends nothing.
  - Literal-only workflows can't reach this case, because the input requires at least one source.
- **Permission.** The step still requires `email:process`. When `ticket_id` is set, it also requires `ticket:read`, as `tickets.find` does.

## 4. Implementation, in order

### 4.1 Runtime

1. **Create `businessOperations/userRecipients.ts`** with `workflowUserRecipientsSchema`, `resolveWorkflowUserRecipients`, `selectEmailableUsers` and `mergeEmailRecipients` (§3). Move the role-expansion and user-existence logic out of `notifications.ts:52-86`.

2. **Refactor `businessOperations/notifications.ts`** to import `workflowUserRecipientsSchema`. Keep its existing `notification-recipients` editor metadata and its picker descriptions. The handler calls `resolveWorkflowUserRecipients` and keeps all ids. Its observable behaviour doesn't change.

3. **Share the additional-resources query from `businessOperations/tickets.ts`.** Export `getCurrentTicketAdditionalUserIds`, or move it to `userRecipients.ts` and import it back into `tickets.ts`.

4. **Change `businessOperations/email.ts`, schema:**
   - `to`: `emailRecipientListSchema.optional()` (was `.min(1)`). Description: "Email addresses".
   - New `users`: `workflowUserRecipientsSchema.optional()` with `x-workflow-editor: { kind: 'custom', custom: { component: 'email-user-recipients' } }`. Description: "Users and roles to email".
   - New `ticket_id`: `withWorkflowPicker(uuidSchema.optional(), "Email this ticket's technicians", 'ticket')`.
   - New `ticket_assignees`: `z.enum(['assigned','assigned_and_additional']).default('assigned_and_additional')`, with option labels "Assigned technician only" and "Assigned technician and additional resources". It is only read when `ticket_id` is set.
   - New `users_as`: `z.enum(['to','cc','bcc']).default('to')`, with labels "To", "Cc" and "Bcc". Description: "Send users and ticket technicians as".
   - New `on_no_recipients`: `z.enum(['error','skip']).default('error')`, with `x-workflow-failure-policy: { failValue: 'error' }` and labels "Fail the step (a surrounding Try/Catch handles it)" and "Continue without sending".
   - Key order, which the designer follows: `to, users, ticket_id, ticket_assignees, users_as, cc, bcc, from, sender_id, mail_class, subject, html, text, template_data, attachment_file_ids, provider_id, on_no_recipients, idempotency_key`.
   - Wrap the object with `withWorkflowRequireOneOf(…, ['to','users','ticket_id'])`. Add a matching `.superRefine`: at least one of a non-empty `to`, a `users` object with at least one non-empty list, or `ticket_id`.
   - Saved v1 workflows, which always have `to`, keep parsing unchanged. The action stays version 1, because the change only adds inputs.

5. **Change `businessOperations/email.ts`, output schema:**
   - `status: z.enum(['sent','skipped'])`
   - new `internal_recipients: [{ user_id, email }]`
   - new `skipped_users: [{ user_id, reason: 'inactive'|'not_internal'|'no_email' }]`

6. **Change `businessOperations/email.ts`, handler**, in this order:
   1. permission checks
   2. settings and provider (unchanged)
   3. if `users` or `ticket_id` is set: `resolveWorkflowUserRecipients`, then `selectEmailableUsers`, then `mergeEmailRecipients`
   4. the cap check on the merged total, moved up from `:185` so it fails before template processing and attachment downloads
   5. the no-recipients policy
   6. template processing, attachments and send (unchanged), using the merged lists

   `writeRunAudit.changedData` currently reads `input.to.length`, which would crash once `to` is optional. It becomes the merged `to_count/cc_count/bcc_count` plus `internal_user_count` and `skipped_user_count`.

   Update `ui.description` to "Send an email to addresses, users, roles, or a ticket's assigned technicians".

7. **Update `shared/workflow/runtime/jsonSchemaMetadata.ts`.** Add `'email-user-recipients'` to `WorkflowEditorCustomComponent`.

### 4.2 Designer (EE)

8. **Generalise the notification editor in `ee/server/src/components/workflow-designer/WorkflowRecipientEditors.tsx`.**
   - Rename `WorkflowNotificationRecipientsEditor` to `WorkflowUserRecipientsEditor` with a `purpose: 'notify' | 'email'` prop that selects the copy. The read/write/parse helpers are reused as they are.
   - `notify` copy keys stay `notificationRecipientsEditor.*`.
   - New `emailUserRecipientsEditor.*` keys: "Email users", "Email everyone with these roles", "Role names (optional)", and the empty hint "Choose users or roles, or pick a ticket below."

9. **Map the new component in `ee/server/src/components/workflow-designer/mapping/workflowCustomLiteralEditor.tsx`.** Add a case `'email-user-recipients'` that reads with `readNotificationRecipientsLiteral` and renders `WorkflowUserRecipientsEditor purpose="email"`.

10. **Add search synonyms in `ee/server/src/components/workflow-designer/searchSynonyms.ts`.** Add `'engineer', 'engineers', 'resource', 'resources'` to the user group. The customer was told "email to the engineer"; ConnectWise says "resource". After this, "email engineer", "email technician" and "email assignee" all rank Send Email.

11. **Add translations to `server/public/locales/<lang>/msp/workflows.json`.** Add the new `emailUserRecipientsEditor.*` keys to `en`, translate them for `de es fr it nl pl pt sv`, and regenerate the pseudo-locales with `node scripts/generate-pseudo-locales.cjs`. Check with `node scripts/find-missing-i18n-keys.cjs`.

### 4.3 Harness fixture

12. **Add `ee/test-data/workflow-harness/ticket-waiting-email-assignees/`** with `bundle.json` and `test.cjs`. It is modelled on `ticket-status-waiting-on-customer-reminder`.
    - Trigger: a ticket status change.
    - Send Email step: `to` is the requester contact; `ticket_id` is `payload.ticketId` with `assigned_and_additional`, sent as `cc`.
    - Assertions: the sent message's To/Cc in the GreenMail-backed email settings fixture, and the step output's `internal_recipients` and `skipped_users`.

### 4.4 Markers

Drop a `// LEVERAGE: pattern ticket-people — ticket assignee/additional-resource reads live in tickets.ts and userRecipients.ts` marker at the moved query, if it doesn't fully move. Drop no other markers: the resolver extraction is the layer itself.

## 5. Tests

### Unit (no DB)

These live in `shared/workflow/runtime/actions/__tests__/`.

- **`registerEmailActionEditorMetadata.test.ts`** (extend):
  - `users` carries the `email-user-recipients` custom editor.
  - `ticket_id` carries picker kind `ticket`.
  - `ticket_assignees`, `users_as` and `on_no_recipients` carry option labels; `on_no_recipients` carries the failure policy.
  - The root has `x-workflow-require-one-of: ['to','users','ticket_id']`.
  - `to` is no longer required.
  - A legacy `{ to, subject, text }` input parses to the same value as before.
  - Input with no recipient source fails the refine.
- **`userRecipients.test.ts`** (new):
  - `selectEmailableUsers` classifies inactive, client and no-email users.
  - `mergeEmailRecipients` removes duplicates case-insensitively with To > Cc > Bcc precedence, honours `users_as`, and counts the final total.
- **`registerNotificationActionsMetadata.test.ts`**: unchanged, and must still pass.

### DB-backed

New file: `shared/workflow/runtime/actions/__tests__/businessOperations.email.db.test.ts`. It follows the `businessOperations.scheduling.db.test.ts` pattern:

- the real migrated test DB from `_dbTestUtils.createTestDbConnection`
- `createTenant` and `createUser`
- mocked `withTenantTransaction` and `requirePermission`
- `workflowEmailRegistry` mocked so that `getWorkflowEmailProvider()` returns a stub with configurable `maxRecipientsPerMessage` and a recorded `sendEmail`

| Id | Covers |
|---|---|
| T1 | `users.user_ids` resolves to addresses with display names in To |
| T2 | An inactive user in `user_ids` is skipped (`skipped_users` reason `inactive`) and the others are emailed |
| T3 | An unknown user id gives `NOT_FOUND` with `missing_user_ids`, and `sendEmail` is not called |
| T4 | A user id from a second tenant gives `NOT_FOUND` (tenant isolation) |
| T5 | A client user by id is skipped as `not_internal`; a client user reached through a role is not emailed |
| T6 | A user with a blank email is skipped as `no_email` |
| T7 | `ticket_id` + `assigned` emails only `assigned_to` |
| T8 | Multi-assignee: `ticket_id` + `assigned_and_additional` emails the assigned user plus every `ticket_resources` additional user once each; an inactive additional resource is skipped |
| T9 | An unassigned ticket gives `NO_RECIPIENTS` under `error`; under `skip` it returns `status: 'skipped'` and doesn't send |
| T10 | A `ticket_id` from a second tenant gives `NOT_FOUND`, "Ticket not found" |
| T11 | `role_ids` and `role_names` (mixed case) expand to role members |
| T12 | A user whose address equals a literal `to` address isn't duplicated; `users_as: 'cc'` puts users in Cc |
| T13 | Recipient cap with the provider stub at max 3: three literals plus one technician gives `VALIDATION_ERROR` with `{count: 4, max: 3}` and no send; exactly 3 sends; role expansion past the cap fails |
| T14 | A legacy literal-only input calls `sendEmail` with the same `to/cc/bcc` as before, and the audit counts are correct |
| T16 | `ticket:read` denied fails the step when `ticket_id` is set and doesn't apply when it isn't |

New file: `shared/workflow/runtime/actions/__tests__/businessOperations.notifications.db.test.ts`.

| Id | Covers |
|---|---|
| T15 | `send_in_app` after the refactor: `user_ids`, `role_ids` and `role_names` give the same `internal_notifications` rows as before; an unknown id still gives `NOT_FOUND` |

### Designer (EE, jsdom)

These live in `ee/server/src/components/workflow-designer/__tests__/`.

- **`WorkflowRecipientEditors.test.tsx`**: `purpose="email"` renders the email copy and writes `{ user_ids, role_ids, role_names }`; the notify copy is unchanged.
- **`workflowCustomLiteralEditor.test.tsx`**: `'email-user-recipients'` renders the editor for literal values and returns null when a part is computed.
- **`paletteSearch.test.ts`**: "email engineer", "email technician" and "email assignee" rank Send Email in the top results.
- **Auto-mapping suggestion test** (`autoMappingSuggestions.test.ts`): Send Email's `ticket_id` gets the `payload.ticketId` suggestion from a ticket trigger.

### How to run

Database settings come from `server/.env.local`, which points at compose project `alga-psa-local-test`. Unit and DB tests:

```bash
cd shared
npx vitest run workflow/runtime/actions/__tests__/registerEmailActionEditorMetadata.test.ts \
  workflow/runtime/actions/__tests__/userRecipients.test.ts \
  workflow/runtime/actions/__tests__/registerNotificationActionsMetadata.test.ts
DB_HOST=localhost DB_PORT=<postgres port> npx vitest run \
  workflow/runtime/actions/__tests__/businessOperations.email.db.test.ts \
  workflow/runtime/actions/__tests__/businessOperations.notifications.db.test.ts
```

Designer:

```bash
cd ee/server
npx vitest run src/components/workflow-designer/__tests__/WorkflowRecipientEditors.test.tsx \
  src/components/workflow-designer/__tests__/workflowCustomLiteralEditor.test.tsx \
  src/components/workflow-designer/__tests__/paletteSearch.test.ts
```

Harness, against the dev server on :3650:

```bash
node tools/workflow-harness/run.cjs --test ee/test-data/workflow-harness/ticket-waiting-email-assignees \
  --base-url http://feature-workflow-action-email-internal-users-ticket-assi.localhost:3650 --tenant <tenant> --force
```

Also run the workflow-related typechecks: `npx tsc --noEmit -p shared` and `npx tsc --noEmit -p ee/server`.

## 6. Acceptance walkthrough (smoke)

1. In the designer at :3650, build Lynda's workflow:
   - Trigger: ticket status changed.
   - An If step for the "Waiting for client" status.
   - A 7-day wait.
   - Send Email A: to the requester contact, which already works.
   - Send Email B: **Ticket** filled with one click from the suggested `payload.ticketId`, and *Assigned technician and additional resources*.
2. Confirm the Communication palette tile shows Send Email, and that searching "email engineer" finds it.
3. Confirm the Users-and-roles picker shows the email copy.
4. Confirm the new step publishes with no "required missing" warning.
5. Test-run against a ticket that has an assigned user and one additional resource. Run Studio should show `internal_recipients` with both users, and the GreenMail inbox should hold the message.
6. Deactivate the additional resource and re-run. The output should list them in `skipped_users` with reason `inactive`.

## 7. Risks

- **`to` becomes optional.** Code that reads `input.to` as always present breaks. Known reads: the audit at `email.ts:210`, the `WorkflowDesigner.tsx` icon mapping (id only, so safe), `workflowDefinitionNormalization.test.ts` (`to` mapping only) and harness bundles (always set `to`). Grep `input.to` and `\.to\b` under `shared/workflow` during implementation.
- **More recipients than the author expects.** A role such as "Technician" can expand to the whole staff. The cap stops runaway sends but not over-broad ones. The editor copy already says "everyone with these roles", which is the same wording risk `send_in_app` already carries.
- **Internal addresses become visible to clients** when a technician shares a message with a client contact. By design, `users_as: 'bcc'` hides them, and the option labels should make that clear.
- **Default `on_no_recipients: 'error'`.** An unassigned ticket fails the run. This is intentional, per the fail-fast standard, and visible in the run list. The author can choose "Continue without sending" or branch on `assigned_to`. The walkthrough should mention it to Lynda.
- **The `send_in_app` refactor** could change behaviour unnoticed. T15 pins it.
- **The "resource" synonym** may surface unrelated actions with "resource" in their label in palette search. The `paletteSearch.test.ts` cases cover the intended ranking; check the top results for "resource" by eye.

## 8. Decisions recorded

These decisions are recorded as durable card facts through `alga-dev workflow-add-fact`:

- option (a) with a shared resolver
- the skip/fail rules in §3.2 and §3.4
- the `ticket_id` field placed at the top level so suggestions reach it
- `send_in_app` semantics unchanged

## 9. Out of scope

- Ticket assignees as a recipient source on `notifications.send_in_app`. The resolver supports it; exposing it needs an inactive-user policy decision for in-app notifications. Follow-up card.
- Other ticket people: the requester contact (already reachable), watchers, the team lead as a separate source, the client's default contact.
- A general `users.find` / `users.search` action.
- Per-recipient messages (one email per user) and per-user locale or templates. This step sends one message with all recipients, as `email.send` does today.
- Honouring user notification preferences or unsubscribe state for workflow email.
- Letting a custom editor host a computed child field. Today a computed part inside `users` drops the editor into field-by-field mode; `ticket_id` avoids this by sitting at the top level. This is a designer-engine change worth its own card.
- `email.send` version 2. These changes only add inputs, so v1 stays.
