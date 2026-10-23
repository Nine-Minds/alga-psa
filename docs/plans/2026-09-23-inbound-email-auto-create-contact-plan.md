# Plan — alga-2026-0002569: auto-create a contact for an unknown sender on a matched client domain

Card: d81eede2-7996-4096-aee2-5a69a77009e6 · Branch `feature/alga-2026-0002569-inbound-email-auto-create-cont`
Worktree HEAD: `9fd1ddb58b` (the card was validated at `636c648b53`, which is an ancestor of this HEAD). All line numbers below are from this worktree.

## 1. Problem

When someone at a known client emails support for the first time, Alga already works out which client they belong to from the domain (`client_inbound_email_domains`). It does not create a contact for them. The ticket goes to the client's **primary contact**, the sender is added only as a watch-list email, and the first comment has no contact author. Staff then have to create the contact by hand and reassign the ticket.

The requested behavior: when a sender whose address matches no contact comes from a mapped domain, create a contact under that client and use it as the ticket contact and comment author.

### How it works today (new-ticket path, `shared/services/email/processInboundEmailInApp.ts`)

- `:1731` `resolveSenderContact(...)` looks for an existing contact or internal user. The match is thrown away (returns `null`) when sender authentication does not align (`:944-977`).
- `:1735-1745` domain fallback. It runs only when there is no rule-assigned client and no matched sender contact. It calls `findClientIdByInboundEmailDomain` and then `findValidClientPrimaryContactId`.
- `:1827-1831` sets `targetClientId = domainMatchedClientId` and `targetContactId = primary contact`.
- `:1833-1851` comment authorship. `commentAuthorContactId` comes only from `matchedSenderContact`, so a domain-matched sender has no author, and `clientMatchSource = 'domain_match'`.
- `:1853-1885` skip/dedupe gates (`!targetClientId`, `existingTicketAfterDefaults`).
- `:1894-1897` an unmatched sender becomes a watch-list recipient (`buildUnmatchedSenderWatchListRecipients`).
- `:1899-1936` `createTicketFromEmail` and `:1938-1965` `createCommentFromEmail`.
- `:1970-1978` attachments are client-visible only when `matchedSenderContact.client_id === targetClientId`.

Contact creation today exists only in the workflow action `create_or_find_contact` (`shared/workflow/runtime/actions/registerEmailWorkflowActions.ts:975`), which wraps `createOrFindContact` (`shared/workflow/actions/emailWorkflowActions.ts:716`). That helper cannot be reused as it is:
- it opens its own `withAdminTransaction`, so it cannot join the durable pipeline's transaction;
- it publishes no `CONTACT_CREATED` event, so the search index, the 3CX phonebook and workflow triggers would never see the contact;
- if the email already belongs to a contact at another client, it falls through to `createContact`, which throws `EMAIL_EXISTS`.

## 2. Design decisions

1. **Opt-in per domain, off by default.** Add `auto_create_contacts boolean NOT NULL DEFAULT false` to `client_inbound_email_domains`. Admins turn it on for each mapped domain in the client's inbound-domain UI.
   - Why per domain and not per tenant: a client can map a shared or consultancy domain where auto-creating contacts is wrong, and a domain row is exactly the "we trust this domain belongs to this client" assertion.
   - Why default off: existing tenants keep today's behavior and contact lists don't grow unexpectedly. Contacts can affect billing and portal invitations.
2. **Only for new tickets, and only on the domain-fallback branch.** Creation happens only in the case where the code would otherwise fall back to the primary contact: no rule-assigned client, no matched sender contact, and a domain match. Rule-assigned clients (`assign_client`) and replies on existing tickets are unchanged (see Out of scope).
3. **Same trust level as matching an existing contact.** Create only when `allowsContactSenderAttribution(senderAuthResults) || isVerifiedListRewrite`. That is the same test that decides whether an existing contact match is kept (`:968`). A spoofed From address must not be able to create an identity that later mail gets attributed to.
4. **Don't create when the address is already known.** `matchedSenderContact === null` does not prove the address is unknown: the match may have been thrown away because authentication failed, or the address may belong to an internal user whose authentication failed. The create helper checks inside its transaction that no contact (primary or additional email) and no internal user already has the address. If one does, it returns `null` and the email follows today's primary-contact fallback.
5. **Skip automated and self mail.** No creation when `detectAutomatedInboundMessage(emailData).isAutomated` (noreply, bounces, auto-submitted) or when `senderIsProviderMailbox`.
6. **Skip inactive clients.** No creation when the target client is inactive (`clients.is_inactive`).
7. **Contact fields.** `full_name` is the display name from `From` (`senderName`, `:1082`), falling back to the email address. This matches the existing `createOrFindContact` fallback. `email` is the normalized sender address, `client_id` is the domain-matched client, and `primary_email_canonical_type` is `'work'` (the model default). No phone, no role.
8. **Transaction and events.**
   - The helper takes `InboundEmailExecutionOptions`, like `createTicketFromEmail`. In durable mode it writes inside `durableExecution.trx`, so a rolled-back inbox commit leaves no orphan contact, and it publishes `CONTACT_CREATED` through the outbox.
   - In non-durable mode it uses its own admin transaction and publishes after commit through `publishWorkflowEvent`, the same pattern as `contactActions.tsx:690-710`.
   - The event payload is built with `buildContactCreatedPayload` (`shared/workflow/streams/domainEventBuilders/contactEventBuilders.ts:41`) and idempotency key `contact_created:<id>`.
9. **Concurrent emails.** Two first emails from the same new sender can be processed at once. The per-tenant unique email constraint (`contacts_email_tenant_unique` plus the additional-email trigger) makes the second insert fail with `EMAIL_EXISTS`. The helper catches that and re-reads the contact. If it now exists at the same client it is used; otherwise the email falls back to the primary contact.
10. **After creation the email is handled like a matched sender.**
    - The ticket `contact_id` and the comment `contact_id` are the new contact, with `author_type` `'contact'`.
    - The sender is not added as an unmatched watch-list recipient.
    - Attachments are client-visible.
    - `unmatchedSender` is `false`.
    - `clientMatchSource` stays `'domain_match'`, and a new `email_metadata.autoCreatedContactId` is recorded so the action can be audited and reversed.
    - Destination resolution (`resolveEffectiveInboundTicketDefaults`) is unchanged, because a new contact has no `inbound_ticket_defaults_id`.

## 3. Changes, in order

### Step 1 — Schema
- **New** `server/migrations/20260923120000_add_auto_create_contacts_to_client_inbound_email_domains.cjs`:
  - `ALTER TABLE client_inbound_email_domains ADD COLUMN IF NOT EXISTS auto_create_contacts boolean NOT NULL DEFAULT false`.
  - Idempotent `hasColumn` guard, following `20260213180500_create_client_inbound_email_domains.cjs`.
  - The table is already distributed, and adding a column with a constant default propagates under Citus. Keep `exports.config = { transaction: false }` for consistency.
  - `down` drops the column.
- Check whether `packages/db/src/lib/tenantTableMetadata.ts` or `ee/server/.../entra/mapping/mappingPreviewService.ts` select `*` or explicit columns from this table. Neither should need changes; confirm.

### Step 2 — Lookup that returns the flag (`shared/workflow/actions/emailWorkflowActions.ts`)
- `:419` add `findInboundEmailDomainMapping(domain, tenant): Promise<{ clientId: string; autoCreateContacts: boolean } | null>`. Select `client_id, auto_create_contacts` and keep the existing "table missing → null" safety.
- Reimplement `findClientIdByInboundEmailDomain` as a thin wrapper, so `registerEmailWorkflowActions.ts:430` and its tests don't change.

### Step 3 — Creation helper (`shared/workflow/actions/emailWorkflowActions.ts`, next to `createOrFindContact` at `:716`)
- Add:
  ```ts
  export async function createContactForInboundSender(
    input: { email: string; name?: string; clientId: string },
    tenant: string,
    executionOptions?: InboundEmailExecutionOptions & { contactEventPublisher?: ... }
  ): Promise<{ contactId: string; created: boolean } | null>
  ```
- Behavior, inside `withAdminTransaction(fn, executionOptions?.existingConnection)`:
  1. Normalize the email.
  2. Return `null` if an internal user has the email.
  3. `ContactModel.getContactByEmail` (covers additional emails). If a contact exists at the same client, return `{contactId, created:false}`. If it exists at another client, return `null`.
  4. Return `null` if the client is missing or inactive.
  5. `ContactModel.createContact({ full_name, email, client_id }, tenant, trx)`.
  6. On `EMAIL_EXISTS`, re-read and apply step 3's rules. This covers the race.
  7. Publish `CONTACT_CREATED`: through the injected outbox publisher in durable mode; otherwise after commit through `publishWorkflowEvent` with `ctx.tenantId`, no actor (system), and `createdByUserId` undefined.
- Contact-creation failures other than the handled cases must not fail the email. Catch them, `console.warn` with tenant/provider/email ids, and return `null` so the primary-contact fallback still creates the ticket. In durable mode, run the create inside a savepoint (`trx.transaction()`) so a failed insert doesn't poison the outer transaction.
- Leave `LEVERAGE: pattern contact-create-with-event` markers on the new helper, `contactActions.tsx:~683`, and `businessOperations/contacts.ts:~925`. That is the third copy of "createContact then build and publish CONTACT_CREATED". Extracting it is out of scope here.

### Step 4 — Durable outbox support (`shared/workflow/adapters/inboundEmailOutboxEventPublisher.ts`)
- Add `publishContactCreated(payload)`. It calls `enqueue({ eventKey: 'contact-created', eventType: 'CONTACT_CREATED', payload })` (`:53`). The dispatcher (`shared/services/email/inboundEmailOutboxDispatcher.ts:99,186`) publishes rows generically by `event_type`, so no dispatcher change is expected. Verify that `CONTACT_CREATED` passes the event-bus schema (`packages/event-schemas/src/schemas/eventBusSchema.ts:362,1364`) on dispatch.
- Pass it through `processInboundEmailInApp` options. Either extend `durableExecution.eventPublishers` (`processInboundEmailInApp.ts:93-96`) with `contact?`, or reuse the ticket publisher instance, since it is the same class. Prefer adding `contact` explicitly and wiring it in `inboundEmailCoreProcessor.ts:310-332` (`contact: ticketPublisher` is acceptable because `suppressCommentEmail` is irrelevant to contact events).
- Check whether an effects-ledger entry (`insertEffect`, `inboundEmailCoreProcessor.ts:338+`) is expected for every created entity. If the ledger lists created entities for replay or dedupe, add a `contact_created` effect. Otherwise record it in diagnostics only.

### Step 5 — Wire it into the new-ticket path (`shared/services/email/processInboundEmailInApp.ts`)
- `:920` import `findInboundEmailDomainMapping` and `createContactForInboundSender` (and drop `findClientIdByInboundEmailDomain` from this file).
- `:1735-1745` use the mapping; keep `domainMatchedClientId` and add `domainAutoCreateContacts`.
- **Placement matters.** Insert the auto-create block after the `!targetClientId` skip (`:1855`) and the `existingTicketAfterDefaults` dedupe (`:1869-1885`), and before building `seededWatchList` (`:1894`). Every skip path then exits before a contact is written.
- Guard (all must hold):
  - `!ruleAssignedClientId && !matchedSenderContact && domainMatchedClientId && domainAutoCreateContacts && senderEmail`
  - `targetClientId === domainMatchedClientId`
  - `!senderIsProviderMailbox`
  - `!detectAutomatedInboundMessage(emailData).isAutomated`
  - `allowsContactSenderAttribution(senderAuthResults) || isVerifiedListRewrite`
- On success set `autoCreatedContactId`. Because `commentAuthorContactId`, `commentAuthorType`, `targetContactId` and `clientVisibleAttachments` are computed before this point, restructure them to use an "effective sender contact id" (`matchedSenderContactId ?? autoCreatedContactId`):
  - `targetContactId` becomes `autoCreatedContactId` (overriding the primary-contact fallback from `:1830`);
  - `commentAuthorContactId` becomes `autoCreatedContactId`;
  - `buildUnmatchedSenderWatchListRecipients(autoCreatedContactId)` returns `[]` (already handled at `:1133`);
  - `unmatchedSender` becomes `false`;
  - the `clientVisibleAttachments` condition becomes true;
  - `email_metadata.autoCreatedContactId` is added.
  - Prefer computing these once, after the auto-create block, over patching `let`s in several places. This part of the file already handles three-way precedence inline, so drop a `LEVERAGE: friction inbound-sender-resolution` marker if it stays awkward.
- Diagnostics: add `senderResolution.autoCreatedContactId` and a skip reason (`auto_create_disabled | auth_not_aligned | automated | exists_elsewhere | client_inactive | error`) to `ProcessInboundEmailInAppDiagnostics` (`:100`) so ops can see why a contact was or wasn't created.
- Log at `info` on creation: `processInboundEmailInApp: auto-created contact for domain-matched sender` with tenant, provider, email id, client id and contact id. Don't log the address beyond what existing logs already do.

### Step 6 — Admin actions (`packages/clients/src/actions/clientInboundEmailDomainActions.ts`)
- Add `auto_create_contacts: boolean` to `ClientInboundEmailDomain` (`:24`) and to the list select (`:79`) and insert `returning` (`:113`).
- `addClientInboundEmailDomain` (`:88`) takes an optional `options?: { autoCreateContacts?: boolean }`, default `false`.
- **New** `setClientInboundEmailDomainAutoCreateContacts(clientId, domainId, enabled)`, gated by `hasMspPermission(user, 'client', 'update')`, scoped by `tenantDb` and matching `client_id`. It returns the updated row or an `actionError`.

### Step 7 — UI (`packages/clients/src/components/clients/ClientDetailsTabContent.tsx:359-419`, state in `ClientDetails.tsx:1163-1260` and `ClientQuickView.tsx:117,258-264,590-625,1037-1041`)
- Widen the domain row type to `{ id; domain; auto_create_contacts }` in both parents and the props interface (`ClientDetailsTabContent.tsx:181`).
- Each domain row gets a `Switch` labeled "Create contacts for new senders". Id: `client-inbound-email-domain-auto-create-${d.id}`. It calls a new `onToggleInboundDomainAutoCreate(d.id, enabled)`, which updates optimistically and reverts on error with a toast.
- Update the helper text (`:363`) to mention auto-create. It is hard-coded English today; move it to i18n while touching it.
- i18n: add keys under `clientDetails` in `server/public/locales/en/msp/clients.json` (next to `:253-256`): `inboundDomainAutoCreateContacts`, `inboundDomainAutoCreateHelp`, `inboundDomainAutoCreateUpdated`, `inboundDomainAutoCreateUpdateFailed`. Add the same keys to the other locale folders following the repo convention (run the locale-parity check if one exists). Follow `alga-tech-doc-writing` for the copy.

### Step 8 — Tests
Unit tests (`shared/services/email/__tests__/`), in a new `processInboundEmailInApp.autoCreateContact.test.ts` using the existing mock harness style from `processInboundEmailInApp.test.ts:30,111`:
- Domain matched, flag on, auth aligned, no contact: `createContactForInboundSender` is called with the From name, email and client. The ticket and comment get the new contact id, `author_type` is `'contact'`, `unmatchedSender` is `false`, there is no unmatched watch-list entry, and `email_metadata.autoCreatedContactId` is set.
- Flag off: no call, and the primary-contact fallback is unchanged (regression).
- Auth not aligned: no call.
- Automated message: no call.
- Provider mailbox sender: no call.
- Rule-assigned client: no call.
- Existing contact matched: no call.
- Helper returns `null`: primary-contact fallback.
- Dedupe hit after defaults (`existingTicketAfterDefaults`): no call. This covers the ordering guarantee.
- Durable mode: the helper receives `existingConnection` equal to `durableExecution.trx` and the contact publisher.

Update the existing mocks that stub `findClientIdByInboundEmailDomain` in the processor tests so they stub `findInboundEmailDomainMapping` instead:
- `processInboundEmailInApp.test.ts`, `.inboundRules.test.ts` (`:198` assertion), `.additionalPaths.test.ts`
- `server/src/test/unit/email/processInboundEmailInApp.threading.test.ts`, `outboundInboundThreadRoundTrip.test.ts`

Helper unit tests in `shared/workflow/actions/emailWorkflowActions.inboundDomainLookup.test.ts`: the mapping returns the flag, and the wrapper still returns the client id.

Integration tests against the DB (`server/src/test/integration/`; extend `resolveInboundTicketContext.domainFallback.integration.test.ts` or add `inboundEmailInApp.autoCreateContact.integration.test.ts`, following the `integration-testing` skill):
- A real contact row is created with the right `client_id`, email, name and `work` type. The ticket's `contact_name_id` equals it.
- A second email from the same sender matches the existing contact (`email_match`) and does not create another.
- An address that is an additional email of a contact at another client is not created and falls back.
- An address that is an internal user's email with failing auth is not created.
- Inactive client: not created.
- Concurrency: two parallel `processInboundEmailInApp` calls for the same new sender produce exactly one contact and two tickets, both linked to it.
- Durable path (`inboundEmailCoreProcessor`): the contact and a `CONTACT_CREATED` outbox row are written in the same transaction. A forced rollback leaves neither.

Action tests for `setClientInboundEmailDomainAutoCreateContacts`: permission denied, wrong client, and success.

Migration: runs on a fresh DB and on an existing one with rows (default `false`). `down` works.

## 4. Verification

1. `npm run typecheck` (or the repo's equivalent) and lint for the touched packages.
2. `npx vitest run` for the unit tests above, the existing `processInboundEmailInApp*` suites and `registerEmailWorkflowActions*`.
3. Integration suite for the new and extended files against the `alga-psa-local-test` DB.
4. Live check on the wired dev server (port 3335) using the `alga-inbound-email-testing` skill (GreenMail + IMAP):
   - Map `acme-test.com` to a client, leave the flag off, and send from `newperson@acme-test.com`. Expect today's behavior: primary contact, sender on the watch list.
   - Turn the flag on in Client Details and send from `another@acme-test.com` with display name "Another Person". Expect a new contact "Another Person" under the client, the ticket contact set to it, a contact-authored first comment, and the contact visible in the contact list and search (confirms `CONTACT_CREATED` reached the indexer).
   - Send again from the same address. Expect no duplicate contact.
   - Send an `Auto-Submitted: auto-replied` message from `bot@acme-test.com`. Expect no contact.
   - Caveat: GreenMail messages may carry no `Authentication-Results`, and then `allowsContactSenderAttribution(null)` is `false`, so the positive case will not create a contact. Inject an aligned `Authentication-Results` header in the test message. Confirm how existing inbound tests handle this before assuming.
5. DB check: `select contact_name_id, full_name, email, client_id from contacts where email = 'another@acme-test.com'`, plus the ticket's `contact_name_id` and `email_metadata->>'autoCreatedContactId'`.

## 5. Out of scope
- **Replies on existing tickets** from unknown same-domain senders (for example a colleague CC'd into a thread). These stay watch-list-only. It is a reasonable follow-up, but it changes reply authorization semantics (`:1247-1257`), so it needs its own decision.
- Rule `assign_client` routing (`:1753-1763`) and exact-match contacts: unchanged.
- Changes to the `create_or_find_contact` workflow action and to `resolve_inbound_ticket_context` (`registerEmailWorkflowActions.ts:380-470`). The latter keeps using `findClientIdByInboundEmailDomain` through the wrapper, and workflow-driven tenants keep their own flow. The existing `createOrFindContact` cross-client `EMAIL_EXISTS` behavior is noted but not fixed here.
- Client-portal invitations or users for auto-created contacts.
- Parsing name, phone or title from signatures.
- A tenant-wide default for the flag, or a REST/API surface for domain mappings (none exists today).
- Extracting a shared "create contact + publish CONTACT_CREATED" layer (left as a LEVERAGE marker).

## 6. Risks
| Risk | Mitigation |
|---|---|
| Spoofed From creates a contact that later mail is attributed to | Same auth bar as keeping an existing contact match (decision 3); opt-in per domain. |
| Contact spam from bulk or automated mail on a mapped domain | Automated-message detection, provider-mailbox exclusion, opt-in flag. |
| Orphan contact if ticket creation fails | Durable: same transaction, rolls back together. Non-durable: the contact persists, but a retry then matches it (`email_match`), so the outcome is still correct. Creation happens after every skip and dedupe gate. |
| Contact insert failure blocks the email | Helper catches unexpected errors and falls back (durable: savepoint). |
| Duplicate contacts under concurrency | DB uniqueness plus the `EMAIL_EXISTS` re-read path; covered by an integration test. |
| Missing `CONTACT_CREATED` (search, 3CX, workflows) | Published on both paths; checked through search in the live test. |
| Breaking existing mocks and callers of `findClientIdByInboundEmailDomain` | Kept as a wrapper; processor test mocks updated in the same change. |
| Citus: `ALTER TABLE ... ADD COLUMN` on a distributed table | Constant default and non-transactional migration, the same pattern as other column adds; run on the local Citus stack. |
| Billing or seat side effects of new contacts | Contacts are not billable seats by themselves. Flag is off by default and there is no portal user creation. Confirm nothing counts contacts for licensing. |

## 7. Note for the card
The card's line references (`processInboundEmailInApp.ts ~1893-2008`, `registerEmailWorkflowActions.ts:953`) are from `636c648b53`. At this worktree's HEAD the domain fallback is at `:1735-1831`, the create/comment calls are at `:1899-1965`, and the action is at `shared/workflow/runtime/actions/registerEmailWorkflowActions.ts:975`.
