# Multiple outbound From addresses, routed by mail type and board

**Card:** alga-2026-0002576 (01472d61)
**Branch:** `feature/alga-2026-0002576-multiple-outbound-from-address-2`
**Date:** 2026-09-26
**Base:** main @ 636c648b53 (plus the 1.6.4 version bump)
**Status:** Plan only. No feature code has been written yet.

## Outcome

A tenant can configure several sender addresses, for example `support@`, `projects@` and `accounts@`, and decide which one each kind of mail uses:

- **By mail type.** Tickets, projects, billing, quotes and sales, appointments, surveys, account and access mail, and a default for everything else.
- **By board.** Ticket mail for a board can use its own sender, so each department that owns a board has its own identity and its own reply inbox.
- **Per send, where a person is sending.** A From dropdown on the invoice send dialog, the quote send dialog, and the workflow `email.send` action.

Tenants on the managed Nine Minds (Resend) transport can pick any local part on a verified domain. This ends the fixed `noreply@` sender.

Mail a tenant has not routed keeps today's behavior exactly.

## What exists today (verified in code)

### Where sender identity is stored

Only two sender identities exist, and both are tenant-wide:

1. **Ticket identity.** `tenant_email_settings.ticketing_from_email` and `ticketing_from_name`.
   - Read by `resolveTicketingFromAddress()` in `server/src/lib/eventBus/subscribers/ticketEmailSubscriber.ts:70-126`, which is called once per handler (`:1041, :1499, :1923, :2234, :2715, :3157`).
   - The comment and closed handlers fall back to `ticket.board_name` and then to `Support` for the display name (`:2719`, `:3161-3166`).
   - The workflow `email.send` action also uses `ticketingFromEmail` as its default From (`shared/workflow/runtime/actions/businessOperations/email.ts:86-94`).
2. **Everything-else identity.** The active provider's `provider_configs[].config.from` and `fromName`, resolved by `resolveDefaultFromAddress()` in `packages/email/src/senderIdentity.ts:118-142`.
   - The local part comes from `config.from`, otherwise `EMAIL_FROM` (`noreply@…`).
   - The domain is always replaced with `defaultFromDomain`.
   - Managed tenants store no `config.from`, so they always get `noreply@<verified-domain>`. The EE UI shows this address read-only (`ManagedEmailSettings.tsx:1143`).

### What does not exist

- The `boards` table has no email fields. Board settings has an "Email & inbound replies" accordion (`packages/tickets/src/components/settings/BoardsSettings.tsx:1886-1985`), which is the natural home for a board sender.
- `notification_categories` and `notification_subtypes` are global reference tables with serial ids that are not stable across environments. Code looks subtypes up by name. There is no tenant-to-sender mapping.

### Send paths that bypass tenant sender settings

These send paths ignore tenant email settings completely. A routing setting cannot reach them until they move to `TenantEmailService`.

| Path | Where | How it sends today |
|---|---|---|
| Invoice send from the UI | `packages/billing/src/actions/invoiceJobActions.ts:424-640` | `SystemEmailProviderFactory` with From set to `process.env.EMAIL_FROM` (`:449`, `:604`). The dialog preview shows the same env value (`:246`, `SendInvoiceEmailDialog.tsx:351`). |
| Invoice email job | `server/src/lib/jobs/handlers/invoiceEmailHandler.ts` → `server/src/services/emailService.ts:95,235` | Legacy nodemailer with `EMAIL_FROM`/`SMTP_FROM`. Used by scheduled sends and prepaid auto-replenishment. |
| Project status update | `packages/projects/src/actions/projectStatusUpdateActions.ts:180,419-499` | System provider with `EMAIL_FROM`. |
| Appointments | `packages/scheduling/src/actions/appointmentRequestManagementActions.ts`, `packages/client-portal/src/actions/client-portal-actions/appointmentRequestActions.ts`, `server/src/app/api/public/appointment-request/route.ts` | `SystemEmailService`. |
| Workflow `email.send` | `shared/workflow/runtime/actions/businessOperations/email.ts` | Sends straight through `EmailProviderManager`: no rate limit, no logo embedding, no `email_sending_logs` entry. |

### Other send paths that ignore sender routing

Everything else goes through `TenantEmailService`, but without `from` and without saying what kind of mail it is:

- project events
- SLA, surveys, quotes, sales orders, credit and hour-block expiry, prepaid alerts
- auth and invitations
- marketing and opportunities

### Transport constraints

- **SMTP** sends `message.from` as given (`SMTPEmailProvider.ts:244-251`). The relay is the only limit.
- **Resend (managed)** does not check the domain locally. Resend's API rejects any sender whose domain is not verified on the shared account. The app-side check is only "the ticketing address must be on `defaultFromDomain`" (`emailSettingsActions.ts:320-329`). `ManagedDomainService.activateDomain` overwrites `default_from_domain`, so a tenant with several verified domains can only use the most recently verified one.
- **Microsoft Graph** ignores `message.from.email`. The provider is bound to one mailbox at init (`MicrosoftGraphEmailProvider.ts:54, 232-236`), and `EmailProviderManager` holds one provider per tenant (`:21, :45, :158-161`). `Mail.Send.Shared` is already requested (`shared/services/email/microsoftGraphEndpoints.ts:19`; shared-mailbox PRD features F001-F008), so the connected account can send as any mailbox it has Exchange **Send As** rights on.

### Settings actions

- `emailSettingsActions.ts` only uses `withAuth`. `getEmailSettings` and `updateEmailSettings` have no RBAC check.
- The earlier sender-identity plan (`docs/plans/2026-08-04-email-sender-identity-plan.md`) has shipped, even though its header still says otherwise. It explicitly ruled out per-type sender identities. This plan reverses that non-goal on purpose.

## Design

### 1. Senders and routes are data. Callers declare what the mail is.

Every call site today either picks its own From or silently takes the default. The new layer inverts this:

- A caller states the **mail class** (and the board, when it knows one).
- `TenantEmailService` resolves the sender in one place.

The ticket subscriber's `resolveTicketingFromAddress` and the six per-handler lookups go away.

#### Mail classes

The mail classes are a closed, code-level enum, `OutboundMailClass`, in `packages/types/src/lib/email.ts`. They follow the notification catalog (`server/migrations/utils/templates/_shared/emailCategoriesAndSubtypes.cjs`), which has no stable ids to reference:

| Class | Covers |
|---|---|
| `ticket` | Ticket created, updated, assigned, comment, closed; auto-close warning; SLA warning, breach and escalation; RMM alert ticket mail; attachment download code; workflow `tickets.close` notify |
| `project` | Project and task events, project billing events, project status updates |
| `billing` | Invoice send and invoice job, credit expiring, hour-block expiring, prepaid alerts |
| `sales` | Quotes, quote expired, sales order confirmation, marketing sequences, opportunity follow-up and digest |
| `scheduling` | Appointment request received, approved, declined, cancelled, and technician assignment |
| `survey` | Survey invitations |
| `account` | Portal invitation, password reset, team invitation, email verification |
| `general` | Template test sends and any send that fits no other class |

Adding a class later is a code change plus a locale string. No migration is needed, because routes store the class key as text and the check constraint is not tied to it.

#### Resolution order

The resolver is `resolveOutboundSender()`, a new function in `packages/email/src/senderIdentity.ts`. It picks the sender in this order:

1. **Explicit sender for this send.** `params.senderId`, from a From dropdown or the workflow `sender_id`. It must reference an active sender of this tenant. If it does not, the send throws.
2. **Board route.** Only when `mailClass === 'ticket'` and `params.boardId` is set.
3. **Mail-class route.**
4. **Default route.**
5. **Today's resolution, unchanged.** Provider `config.from`, then the env/domain-derived address (`resolveDefaultFromAddress`).

The display name is resolved separately. It is the first of these that is set:

1. The per-send `fromName`
2. The matched route's `display_name`
3. The sender's `display_name`
4. For `ticket` mail only: the board name, then `Support`. This keeps the board-name fallback the comment and closed handlers have today.
5. The existing name chain from `resolveDefaultFromAddress` (provider name, then tenant company, and so on)

A route may leave `sender_id` null and set only `display_name`. This keeps today's "ticket display name with no ticket address" setting. It also lets a managed tenant with a single verified address still brand each board ("Acme Projects").

`params.from` (a raw address) remains for the system fallback path and for tests. Product call sites stop passing it, and a lint-level grep test enforces that (see Tests).

### 2. Schema

There are two new tenant tables. Both are distributed on `tenant` under Citus, following the pattern in `server/migrations/20260904210725_ticket_comment_attachments.cjs:26-30`.

Both must be registered in:

- `packages/db/src/lib/tenantTableMetadata.ts`
- `server/migrations/utils/tenantDb.cjs`

#### `email_sender_addresses`

| Column | Type | Notes |
|---|---|---|
| `tenant` | uuid, not null | Primary key is (`tenant`, `sender_id`) |
| `sender_id` | uuid, not null, default `gen_random_uuid()` | |
| `email_address` | text, not null | Stored lowercased and trimmed. Unique on (`tenant`, `email_address`). |
| `display_name` | text, null | |
| `microsoft_provider_id` | uuid, null | Foreign key (`tenant`, `microsoft_provider_id`) → `email_providers`. The connected mailbox whose token sends as this address. Required when the tenant's transport is Microsoft; otherwise null. |
| `verification_status` | text, not null, default `'unverified'` | Check constraint: `unverified`, `verified` or `failed`. |
| `verified_at` | timestamptz, null | |
| `last_verification_error` | text, null | |
| `created_at`, `updated_at` | timestamptz | |

#### `email_sender_routes`

| Column | Type | Notes |
|---|---|---|
| `tenant` | uuid, not null | Primary key is (`tenant`, `route_id`) |
| `route_id` | uuid, not null | |
| `route_type` | text, not null | Check constraint: `default`, `mail_class` or `board`. |
| `mail_class` | text, null | Set only when `route_type = 'mail_class'`. |
| `board_id` | uuid, null | Set only when `route_type = 'board'`. Foreign key (`tenant`, `board_id`) → `boards`, `ON DELETE CASCADE`. |
| `sender_id` | uuid, null | Foreign key (`tenant`, `sender_id`) → `email_sender_addresses`, `ON DELETE RESTRICT`. |
| `display_name` | text, null | |
| `created_at`, `updated_at` | timestamptz | |

Constraints on `email_sender_routes`:

- A check constraint requires the key column that matches `route_type`, and requires at least one of `sender_id` and `display_name`.
- Partial unique indexes allow at most one `default` row per tenant, one row per (`tenant`, `mail_class`) and one row per (`tenant`, `board_id`).

The route data does not go into `boards` or `tenant_email_settings` columns:

- `board.interface.ts:49-55` warns against more column-per-setting board fields.
- A single routes table gives the resolver one indexed lookup per send, which is cached with the settings.
- It leaves room for later route types, such as client or project, without schema churn.

#### Backfill

The backfill runs in the same migration, for each tenant with a non-empty `ticketing_from_email` or `ticketing_from_name`:

- If an email is set: insert a sender with that address and name. Link `microsoft_provider_id` when the address matches a Microsoft `email_providers.mailbox`. Set `verification_status` to `verified`, because it is already sending in production.
- Insert a `mail_class = 'ticket'` route pointing at that sender. If only a name was configured, the route has a null `sender_id` and that `display_name`.

`ticketing_from_email` and `ticketing_from_name` stay in the schema for one release, so a rolling deploy with old pods keeps working. New code stops reading and writing them. A follow-up migration drops them; that migration is a separate change, not part of this card.

### 3. Rules for which senders a tenant may add

Each transport has its own rule. The rules are enforced in the create and update actions, and again at send time. Send time matters because a domain can be removed or Send As revoked after a sender is saved.

- **Resend (managed).** The domain must be a `verified` row in `email_domains` for the tenant. `defaultFromDomain` alone is not enough, so this also fixes the "only the latest verified domain works" limit. Any local part is allowed.
  - `ManagedDomainService.deleteDomain` refuses to delete a domain that senders still use, and the error names those senders. It does not orphan routes.
- **SMTP.** Any syntactically valid address. The UI warns that the relay must allow it, and a test send verifies it.
- **Microsoft 365.** The sender must name a connected mailbox (`microsoft_provider_id`).
  - If the address is that mailbox, it is `verified` at save.
  - If it is a different address, it is sent as through that mailbox's token using `Mail.Send.Shared`, and stays `unverified` until a test send succeeds. Graph returns 403 when Send As is missing, and that result is recorded in `last_verification_error`.
- **All transports.**
  - A route may only point at a sender whose status is `verified`, or on SMTP, at an `unverified` sender after an explicit confirmation.
  - Ticket-class and board routes show a warning when no active inbound `email_providers.mailbox` matches the sender address, because client replies would not come back into Alga. This is a warning, not a block: some MSPs forward replies to a monitored inbox.
- **Changing the transport.** `updateEmailSettings` re-validates every sender against the new transport. It rejects the change and lists the senders that would break. It does not silently unroute them. This keeps the sender-identity plan's "never silently rewrite routing" rule.

**Failure policy at send time (fail fast, per `docs/AI_coding_standards.md`).** If a routed sender fails validation at send time, for example because its domain is no longer verified, the send throws a descriptive error naming the sender and the route. The failure is recorded in `email_sending_logs` and on the sender's `last_verification_error`. The send does not fall back to the default address, because that would silently change where client replies go.

The existing tenant-to-system fallback (`TenantEmailService.ts:231-234`, which uses the platform address and moves the tenant address to Reply-To) still applies when the whole tenant provider cannot initialize. That path does not involve a tenant address.

### 4. Sending as a routed sender on Microsoft

- `MicrosoftGraphEmailProvider` honors `message.from.email`.
  - If it equals the bound mailbox, the send is unchanged.
  - Otherwise it posts to `/users/{from.email}/sendMail` with the bound account's token, and sets `from` in both the JSON payload and the MIME payload.
  - The adapter change goes in `shared/services/email/providers/MicrosoftGraphAdapter.ts` (`getMailboxBasePath`, `:159`).
- `EmailProviderManager` keeps one provider per connected mailbox rather than one per tenant.
  - The provider is chosen from the resolved sender's `microsoft_provider_id`, or the selected outbound mailbox when there is no routed sender.
  - `resolveMicrosoftProviderConfig` (`:242-302`) is given a provider id instead of reading the single selected one.
- 403 responses are classified as "Send As not granted for `<address>` via `<mailbox>`". This partly covers shared-mailbox PRD features F009-F013. Coordinate with that PRD so the classification code is written once.

### 5. Server actions

The new file is `packages/integrations/src/actions/email-actions/emailSenderActions.ts`. Every action uses `withAuth` and checks `hasPermission(user, 'settings', 'update' | 'read')`, which is the resource other tenant settings actions use.

| Action | What it does |
|---|---|
| `listEmailSenders` | Returns senders plus their verification state, and the list of routes. |
| `createEmailSender`, `updateEmailSender` | Validate as described in section 3. |
| `deleteEmailSender` | Rejects the delete while any route references the sender, and lists those routes. |
| `verifyEmailSender` | Sends a test message to the acting user through the resolved transport. Records status and error. |
| `setEmailSenderRoute`, `clearEmailSenderRoute` | Upsert or remove a route by `default`, class or board. |
| `listSelectableSenders` | Read-only and permission-light. Returns the senders a user may choose in a From dropdown, the effective default for a given class and board, and an `allowOverride` flag. |

Every write invalidates `TenantEmailService.invalidateTenantSettings`. Routes and senders are loaded and cached together with the tenant settings in `TenantEmailService.getTenantEmailSettings`, so resolving a sender adds no query per send.

`updateEmailSettings` changes:

- Stop accepting `ticketingFromEmail` and `ticketingFromName`. Both are replaced by the ticket route.
- Add the transport re-validation from section 3.
- Add the missing `settings:update` check, and add `settings:read` to `getEmailSettings`.

The board save path (`packages/tickets/src/actions/board-actions/boardActions.ts` `updateBoard`) does not store the sender. The board editor calls `setEmailSenderRoute` for board routes, so the RBAC rule and the validation stay in one place.

### 6. Engine changes in `@alga-psa/email`

- `BaseEmailParams` (`packages/email/src/BaseEmailService.ts:64-104`) gains:
  - `mailClass: OutboundMailClass`, required for tenant sends. Making it required at the type level forces every call site to be classified, and the compiler lists any that are missed.
  - `boardId?: string` and `senderId?: string`.
  - `sendEventEmail` (`server/src/lib/notifications/sendEventEmail.ts:62`) and `EmailNotificationService.sendNotification` (`packages/notifications/src/notifications/email.ts:370-445`) gain the same fields and forward them.
- `TenantEmailService.getFromAddress` (`:353-363`) calls `resolveOutboundSender` and returns the address, the name, and the Microsoft provider id. `sendEmail` passes that id to `EmailProviderManager`.
- Delete the stale comment at `TenantEmailService.ts:124-127`. Nothing reads the ticket's inbound `providerId` for From selection.
- `packages/notifications/src/notifications/email.ts:45-56` has its own settings mapper, which drops fields. Replace it with `TenantEmailService.getTenantEmailSettings`. This removes a mapper that would otherwise need the new fields as well.
- `DelayedEmailQueue` and `EventEmailRetryQueue` already re-send the stored params, so `mailClass`, `boardId` and `senderId` survive retries. Add a test that proves it.

### 7. Call-site migration (grouped by class)

**Ticket (`ticketEmailSubscriber.ts`)**
- Delete `resolveTicketingFromAddress` and every per-handler `from` and board-name fallback.
- Pass `mailClass: 'ticket'` and `boardId: ticket.board_id`. The ticket row from `fetchTicketForEmail` already has it.
- Apply the same change to:
  - `ticketAutoCloseWarningSubscriber.ts:110`
  - `packages/sla/src/services/slaNotificationService.ts:535-551`
  - `packages/sla/src/services/escalationService.ts:402-463`
  - `rmmAlertNotificationSubscriber.ts:148`
  - `server/src/app/api/ticket-comment-attachments/download/route.ts:51`
  - workflow `tickets.close` notify (`shared/workflow/runtime/actions/businessOperations/tickets.ts:1319-1336`)
  - where needed, add the board id to the query that loads the ticket

**Project**
- `projectEmailSubscriber.ts`: pass `mailClass: 'project'` at `:354` and `:412`.
- Move `projectStatusUpdateActions.ts:419-499` onto `TenantEmailService` with `mailClass: 'project'`. Remove `senderEmail()` (`:180`).

**Billing**
- Move `sendInvoiceEmailAction` (`invoiceJobActions.ts:424-640`) onto `TenantEmailService` with `mailClass: 'billing'` and an optional `senderId`. The preview reports the resolved sender through `listSelectableSenders`, not `EMAIL_FROM`.
- Change the `invoice_email` job (`invoiceEmailHandler.ts:111,295`) to send through `TenantEmailService` and carry `senderId` in the job payload.
  - Delete `server/src/services/emailService.ts` once nothing calls it.
  - Also delete `server/src/utils/email/emailService.tsx` if the search confirms it is unused.
- Pass `mailClass: 'billing'` in:
  - `creditExpiringSubscriber.ts:157-174`
  - `hourBlockExpiringSubscriber.ts:148-163`
  - `prepaidBalanceAlertDelivery.ts:1168`

**Sales**
- Pass `mailClass: 'sales'` in:
  - `quoteActions.ts:598`, plus an optional `senderId`
  - `crm.ts:771-797`
  - `expireQuotesHandler.ts:67`
  - `salesOrderDocumentActions.ts:181`
  - `packages/marketing/src/lib/sequences.ts:439`
  - `ee/server/src/lib/opportunities/draftingActions.ts:196`
  - `packages/opportunities/src/lib/weeklyDigest.ts:111`

**Scheduling**
- Move the three appointment modules onto `TenantEmailService` with `mailClass: 'scheduling'`. Add a `SystemEmailService` fallback of the same shape as `sendPasswordResetEmail`, so tenants without a provider still get these emails.

**Survey**
- `surveyService.ts:288`: pass `mailClass: 'survey'`. Pass `boardId` too when the subject is a ticket, extending `loadSubject` (`:413`). That makes a ticket survey come from the board's address. Survey mail is not routed by board unless the captain chooses that (see open questions).

**Account**
- Pass `mailClass: 'account'` in:
  - `sendPortalInvitationEmail.ts`
  - `sendPasswordResetEmail.ts`
  - `sendTeamInvitationEmail.ts`
  - `sendVerificationEmail.ts`
- Keep the explicit `<MSP> Portal` `fromName` on portal invitations. It still overrides the name.

**General**
- `notificationActions.ts:482` (template test send).

**Workflow `email.send`** (`shared/workflow/runtime/actions/businessOperations/email.ts`)
- Replace the free `from` domain check with an optional `sender_id` input. The designer shows it as a sender picker, and it defaults to the class route. Also add an optional `mail_class` input, defaulting to `general`.
- Send through `TenantEmailService`.
- Keep `from` as a deprecated input for one release so saved workflows keep running. It is accepted only when it matches a configured sender or the effective default. Otherwise the step fails with an actionable error.
- Update `workflowEmailRegistry.ts` and the designer schema.

**Left on `SystemEmailService` on purpose (platform mail, not tenant-branded):**
- cancellation emails
- webhook auto-disable
- EE reactivation
- Temporal platform activities
- registration verification
- client-portal tenant recovery

### 8. UI

#### Settings > Email > Outbound (CE and EE)

Replace the two-card `EmailSenderIdentityCards` (`packages/integrations/src/components/email/admin/EmailSenderIdentityCards.tsx`) with two new shared components, used by both `EmailSettings.tsx` (CE) and `ManagedEmailSettings.tsx` (EE):

- **`EmailSenderAddressesCard`.** A table of senders with columns for address, display name, sending mailbox (Microsoft only), status badge, and actions (Verify, Edit, Delete). The Add dialog adapts to the transport:
  - **Managed:** a local-part input plus a verified-domain select.
  - **SMTP:** a free address input.
  - **Microsoft:** a "send through" mailbox select plus an address input, with Send As help text.
- **`EmailSenderRoutingCard`.** One row for "Default (all other mail)" and one row per mail class. Each row has:
  - a sender `CustomSelect`, whose first option is "Use default" and shows the effective address
  - an optional display-name input
  - the inbound-reply warning on the ticket row

  A read-only summary of board overrides links to each board's settings.

Other UI changes:

- The EE "notification address is read-only" behavior (`ManagedEmailSettings.tsx:1143`, `lockedAddressHelp`) goes away. Managed tenants choose the default sender from the verified-domain senders.
- The SMTP card keeps its transport-level `from` as the address the provider initializes with. The routing card's Default row overrides it when set.
- Remove the dead CE domain state and helpers (`loadDomains`, `addDomain`, `renderDomainStatus`). They are unrendered, and they would otherwise be confused with the new sender list.
- Locale strings go under `email-providers.json` (EE) and `msp/admin` `email.senderIdentities.*` (CE), with the same keys where the copy is shared. Follow `alga-tech-doc-writing` for the copy.
- Every interactive element gets a stable `id`, for example `email-sender-add`, `email-sender-verify-<id>` and `email-sender-route-<class>`. Components come from `@alga-psa/ui`, use theme tokens only, and are checked in dark mode.

#### Board settings

In `BoardsSettings.tsx`, the "Email & inbound replies" section gains a **"Send ticket email from"** `CustomSelect`. Its options are "Use ticket default (`<effective>`)" and then each verified sender. It also has an optional display-name input and the inbound-reply warning. It saves through `setEmailSenderRoute` and `clearEmailSenderRoute`.

#### From dropdowns (per-send override)

- **`SendInvoiceEmailDialog.tsx`.** Replace the read-only `fromEmail` preview with a sender select. It defaults to the billing route and passes `senderId` through both the immediate send and the scheduled job.
- **Quote send dialog.** Same pattern, defaulting to the sales route.
- **Workflow designer `email.send`.** A sender picker (see section 7).

A dropdown only renders when the tenant has more than one selectable sender. Otherwise it shows the resolved From as text, which is today's behavior.

### 9. Deliberately not being done

- **No sender override per notification subtype.** Routing is per class, which covers all three Discord requests. A subtype matrix is roughly 40 rows of settings for no stated need. The routes table can take a `notification_subtype` route type later without a schema redesign.
- **No per-project, per-client or per-contact routes.** These are possible later route types.
- **No From dropdown on the ticket comment composer.** Board routing already gives each department its own ticket identity, and a per-comment sender would split one ticket thread across several reply inboxes. Revisit only if asked.
- **No automatic "reply from the mailbox the ticket arrived on"** using `tickets.email_metadata.providerId`. Board routes express the same thing explicitly, and inbound-defaults already map mailbox to board. This could become a later route rule.
- **No change to which address inbound mail is read from, and no new inbound mailboxes.** Replies route correctly only when the sender address is monitored. This plan warns about that; it does not create the mailbox.
- **No per-sender Resend API keys or accounts.** Senders share the tenant's managed transport and its verified domains.
- **No change to `activateDomain` overwriting `default_from_domain`.** It no longer blocks anything, because sender validation reads `email_domains` directly. The overwrite still decides the domain of the implicit env-derived default. Cleaning it up is a separate change.
- **`ticketing_from_*` columns are not dropped in this change.** They are backfilled and then ignored. The drop is a follow-up migration after one release.
- **Workflow `email.send` rate limiting and logging** do come along with the move to `TenantEmailService`, but workflow email templating is not redesigned.

### 10. Implementation order

Each step is shippable alone and keeps existing behavior until a tenant configures a route.

1. **Types and schema.**
   - Add `OutboundMailClass` and the sender and route types to `@alga-psa/types`.
   - Write the migration (both tables, the Citus distribution, constraints, and the backfill of `ticketing_from_*`).
   - Register both tables in `tenantTableMetadata.ts` and `tenantDb.cjs`.
   - Add `create_distributed_table` under the same Citus guard used by existing migrations.
2. **Resolver and engine.**
   - `resolveOutboundSender` and its settings-cache integration.
   - The new `BaseEmailParams` fields, `TenantEmailService.getFromAddress`, and forwarding through `sendEventEmail` and `sendNotification`.
   - Unit tests for the precedence rules.
3. **Microsoft multi-mailbox and Send As.** Per-mailbox providers in `EmailProviderManager`, the adapter's `/users/{from}` path, and 403 classification.
4. **Server actions.** Sender CRUD, verify, routes, selectable senders; transport re-validation in `updateEmailSettings`; RBAC on the existing actions; `deleteDomain` guard.
5. **Ticket call sites.** Remove `resolveTicketingFromAddress` and classify the ticket-adjacent sends. The backfilled ticket route must reproduce today's ticket From exactly. The ticket integration and e2e suites are the gate for this.
6. **Remaining classified call sites.** Make `mailClass` required, then fix every compiler error, class by class.
7. **Bypass paths onto `TenantEmailService`.** Invoice UI send, invoice job, project status update, appointments, workflow `email.send`. Delete the legacy nodemailer service.
8. **Settings UI.** The senders and routing cards in CE and EE, removal of the old cards and the dead CE domain code, and locale strings.
9. **Board editor sender section, and the From dropdowns** (invoice, quote, workflow designer).
10. **Docs.** Update the sender-identity plan header to say it shipped and point here. Add a short customer-facing guide section under the website docs if the captain wants it (see open questions).

### 11. Tests

**Unit** (`packages/email/src/__tests__/`)
- Resolver precedence for every level, including name-only routes, the ticket board-name fallback, and an explicit `senderId` owned by another tenant (must throw).
- Send-time validation: a domain removed after save throws; the send never silently falls back.
- Rewrite `TenantEmailService.fromAddress.test.ts` to cover routed and unrouted sends.
- Retry queues keep `mailClass`, `boardId` and `senderId`.

**Providers**
- Microsoft: sending as the bound mailbox; sending as another address, checking the `/users/{addr}` path and the JSON/MIME `from`; a 403 is classified.
- Per-mailbox provider selection in `EmailProviderManager`.

**Actions** (`emailSenderActions.test.ts`, extending `emailSettingsActions.providers.test.ts`)
- Transport rules for Resend (verified domain), SMTP and Microsoft.
- Delete blocked while routed.
- Transport change rejected when it would break senders.
- RBAC denials.
- The `deleteDomain` guard.

**Migration.** An integration test in which a tenant with `ticketing_from_email`/`ticketing_from_name` (and a name-only tenant) resolves to the identical ticket From before and after.

**DB integration** (extending `server/src/test/integration/emailSenderIdentity.integration.test.ts`)
- A board route beats a class route, which beats the default.
- An invoice sent from the UI uses the billing sender through the tenant provider.

**UI**
- Tests for `EmailSenderAddressesCard` and `EmailSenderRoutingCard`.
- Update `ManagedEmailSettings.actions.test.tsx` and `EmailSettings.test.tsx`.
- The board editor sender section.
- The invoice dialog sender select.

**Guard test.** A repository grep test that fails if any product call site passes a raw `from:` to `TenantEmailService.sendEmail` or `sendEventEmail` outside an allowlist (the system fallback and tests). This keeps the "callers declare the class" layer intact.

**E2E.** Update the `ticketing_from_email` seeds in `e2e-tests/tests/inbound-email.spec.ts` and `microsoft-mailbox.spec.ts` to seed a sender and a ticket route instead.

**Manual smoke** (write it with `alga-manual-smoke-tests`):
- On a managed tenant with a verified domain, add `support@`, `projects@` and `accounts@`.
- Route tickets, projects and billing, and give one board its own sender.
- Create a ticket on that board, update a project, and send an invoice. Check each From and each Reply-To.

### 12. Risks

- **Reply routing.** A ticket or board sender without a monitored inbound mailbox sends client replies somewhere Alga never reads. The mitigation is the inbound-reply warning on ticket and board routes, and the verify flow. Blocking was rejected because forwarding setups are legitimate.
- **Microsoft Send As.** The address can be saved while Exchange Send As is missing or later revoked. Sends then fail loudly by design, so notifications stop instead of going out from the wrong address.
  - Mitigations: verification before routing, a status badge and last error, and 403 classification.
  - The captain should confirm fail-fast over a silent fallback to the default (see open questions).
- **Bypass-path migrations change delivery for invoices, project status updates, appointments and workflow email.** These start going through the tenant's transport, rate limit and logging instead of the platform `EMAIL_FROM`. That is the fix, but:
  - A tenant whose transport is misconfigured, and who got invoices out only because of the bypass, will now see failures.
  - Mitigation: the system fallback of the same shape as password reset, for tenants with no provider.
  - The release note should call this out.
- **Required `mailClass` touches about 40 call sites across packages.** The compiler finds them all, but every one needs a correct class. Review each class group together with the notification catalog.
- **Rolling deploy.** Old pods still read `ticketing_from_*`. The backfill leaves the columns populated, and new code does not write them. A ticket route changed during the rollout window is not visible to old pods until they are gone. This is acceptable and short.
- **Settings cache.** Routes are cached with the tenant settings. Every sender and route write must invalidate the cache, or sends keep using stale routing until the TTL expires. Tests cover the invalidation.
- **Citus.** New foreign keys (to `boards` and `email_providers`) must include `tenant` and stay co-located. Verify in the CI Citus smoke.
- **Workflow `email.send` compatibility.** Saved workflows with a free `from` on an allowed domain that is not a configured sender will fail after the change. Mitigation: before the change ships, a one-time migration step creates senders for distinct `from` values found in published workflow definitions, if those definitions can be queried reliably. Otherwise the step fails with an actionable error, and this goes in the release notes.

### 13. Open questions for the captain

1. **Scope of routing.** Is per-class routing plus per-board ticket routing enough? The alternative is a per-notification-subtype override now. The plan recommends per-class.
2. **Surveys.** Should ticket surveys follow the board's sender? The plan says yes, by passing `boardId`.
3. **Send failures.** When a routed sender fails at send time: fail fast (the plan) or fall back to the default address? Fail fast means a missed notification; fallback means a wrong reply inbox.
4. **Customer docs.** Is a customer-facing docs page wanted in this card, or as a follow-up?
