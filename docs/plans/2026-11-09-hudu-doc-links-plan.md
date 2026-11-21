# Documentation links on ticket templates (Hudu and other references)

Date: 2026-11-09
Request: Joymode Business Solutions, PSA ticket alga-2026-0002909. Joymode documents renewal procedures (for example, the APNs certificate renewal) in Hudu and wants every generated renewal ticket to link to that documentation.
Done when: a recurring definition whose ticket template carries a Hudu article link generates tickets that show that link.

All file:line references are against `0184722cd6` (origin/main at the time of writing). This branch contains no implementation yet.

## 1. What exists today

### 1.1 Templates cannot carry links

- `ticket_templates` columns are name, notes, title, description, board/category/subcategory/priority, ITIL impact/urgency, `tags` jsonb, `custom_fields` jsonb, `is_active`, `source_ticket_id` and audit columns (`server/migrations/20261013041821_create_ticket_templates.cjs:43-66`). `client_id` and `offer_for_manual_use` were added later. No links column and no links child table.
- The only child table is `ticket_template_checklist_items` (same migration, `:69-84`).
- The input schema (`packages/tickets/src/lib/ticketTemplateSchema.ts:27-76`) and the REST schema (`server/src/lib/api/schemas/ticketTemplate.ts:21-42`) are both `.strict()` and have no link field. Today an API caller sending `external_links` gets a 400.
- `TemplateForInstantiation` (`packages/tickets/src/lib/instantiateTicketTemplate.ts:32-48`) and `ITicketTemplate` (`packages/tickets/src/actions/ticketTemplateActions.ts:78-113`) carry no links.
- Recurring overrides (`packages/tickets/src/lib/recurring/effectiveFields.ts:12-33`) have four groups: board, priority, category and assignment. They have no links group.

Conclusion: neither templates nor recurring definitions can carry links. Both need new storage.

### 1.2 Ticket external links

- Storage: `external_entity_links` (`server/migrations/20260913120000_create_external_entity_links.cjs:61-130`). Each row has a `system` registry key, `external_id`, an optional `realm`/`url`, `relationship` (`origin` | `mirror` | `reference`), `portal_visible`, `metadata` jsonb and `created_by`. The table has no title column.
- Uniqueness: `external_entity_links_external_unique` on `(tenant, system, external_id, COALESCE(external_parent_id,''), entity_type)` (`:108-113`), plus an application pre-check (`packages/tickets/src/actions/externalLinks/externalLinkPersistence.ts:288-302`). This means an external record can be linked to only one ticket per tenant, whatever the relationship. See §2.1. That is a problem for this feature.
- Validation: `prepareExternalLink` (`externalLinkPersistence.ts:197-265`) resolves the system and rejects a non-http(s) `url`. `assertLinkDestination` (`:164-174`) requires a URL that resolves.
- In-transaction create path: `persistExternalLinksForCreate` (`:381-423`). It forces `portal_visible: false` (`:395`) and writes the activity with a hardcoded `TICKET_ACTIVITY_ACTOR.USER` (`:404-407`). It publishes no events; its callers publish `TICKET_EXTERNAL_LINK_ADDED` after commit (`server/src/lib/api/services/TicketService.ts:2033-2037`, `:2130`).
- System registry: `BUILT_IN_EXTERNAL_SYSTEMS` (`packages/types/src/interfaces/externalSystem.interfaces.ts:47-104`) lists discord, slack, github, jira, email, client_portal, api and generic. There is no `hudu` entry. Tenant systems are `custom:<slug>` rows.
- Display: `ExternalLinkDisplay` (`packages/tickets/src/actions/externalLinks/externalLinkActions.ts:55-63`) is `{label (system name), icon, href, realmLabel}`. A link therefore shows as "system name + external id", with no human title.
- Deleting a custom system is blocked only by `external_entity_links` usage (`externalLinkActions.ts:547-557`).

### 1.3 Ticket creation paths that start from a template

| Path | Code | Uses |
|---|---|---|
| Recurring generator | `packages/tickets/src/lib/recurring/generateRecurringTicketsForTenant.ts:409-432` | `instantiateTicketTemplate` → `createTicketWithSideEffects` → `applyCreatedFromTemplateEffects` |
| REST `POST /api/v1/tickets/templates/{id}/instantiate` (and therefore MCP) | `server/src/lib/api/controllers/ApiTicketTemplateController.ts:257-296` | `instantiateTicketTemplate` (same chain) |
| In-app "New ticket from template" (QuickAddTicket) | `packages/tickets/src/actions/ticketActions.ts:785-797`, `:941-958` | `addTicket` composes its own create and calls `applyCreatedFromTemplateEffects` directly |

The one choke point all three share is `applyCreatedFromTemplateEffects` (`shared/services/tickets/createTicketWithSideEffects.ts:116-149`, called from `:329-335` and `ticketActions.ts:942`). `instantiateTicketTemplate` is not that choke point. The card brief says it "covers manual use", but in-app manual use bypasses it (§7, mismatch M3).

### 1.4 EE Hudu integration

- Connection row: `hudu_integrations.base_url` plus `settings` jsonb, which includes a companies cache (`ee/server/src/lib/integrations/hudu/huduIntegrationRepository.ts:25-60`).
- URL building: `buildHuduRecordUrl(record, baseUrl)` (`ee/server/src/lib/integrations/hudu/referenceData.ts:130-140`) makes Hudu's record `url` absolute against `base_url`. `buildHuduCompanyUrl` (`:152-173`) is the company fallback.
- Article listing: `listHuduArticlesAcrossCompanies` (`ee/server/src/lib/actions/integrations/huduGlobalDocsActions.ts:86-150`) makes a live Hudu call (`createHuduClient(...).listAllArticles`, `:102-103`). It returns `{id, name, url, company_id, ...}` with `url` already absolute (`:126-130`). Access goes through `withHuduClientReadAccess`.
- Company mappings (`getHuduCompanyMappingRows`) map Hudu company → Alga client.

## 2. Design

### 2.1 Change the uniqueness rule so a reference can sit on many tickets

The card's done criterion cannot be met with today's index. The second occurrence of a schedule would try to link the same Hudu article to a second ticket. `insertExternalLink` would throw `duplicate_external_link`, and `persistExternalLinksForCreate` is documented to roll back the owning entity (`externalLinkPersistence.ts:375-380`). Every occurrence after the first would then fail.

The rule "one Alga entity per external record" is correct for identity relationships. `origin` and `mirror` mean that this ticket *is* that thread or issue, and integrations rely on that. A `reference` is a citation, and many tickets may cite the same KB article. The fix is a change to the rule itself, scoped by relationship:

- Replace `external_entity_links_external_unique` with a partial unique index of the same shape, `... WHERE relationship IN ('origin','mirror')`.
- Add `external_entity_links_reference_unique` on `(tenant, entity_type, entity_id, system, external_id, COALESCE(external_parent_id,'')) WHERE relationship = 'reference'`. This keeps one citation per record per entity.
- Mirror both rules in the `insertExternalLink` pre-check (`:288-302`): branch on `prepared.relationship`.
- `updateExternalLink` changes `relationship` (patch field). Moving a `reference` to `mirror` must re-run the identity pre-check, so give the update path the same branch.
- Both indexes include `tenant`, so they are Citus-safe. Create them after dropping the old index, in a `transaction: false` migration like the original.

This also fixes ad-hoc linking. Today a technician cannot cite the same Hudu or Confluence page on two tickets.

Read paths: `TicketService.applyTicketFilters` (`server/src/lib/api/services/TicketService.ts:3591-3609`) filters with `EXISTS`, so many matches are correct. The client portal (`packages/client-portal/src/lib/portalTicketExternalLinks.ts:18`) reads per ticket and is unaffected.

### 2.2 A built-in `hudu` system and a link title

- Add a built-in `{ key: 'hudu', label: 'Hudu', icon: 'BookOpen', originCategory: 'other' }` with no `urlTemplate`. Each tenant runs its own Hudu host and article paths are Hudu's own, so `assertLinkDestination` requires an explicit absolute URL. The entry is CE-safe because it is only a label. CE tenants can paste Hudu URLs too. The EE integration only adds the picker.
- Add a nullable `title text` column to `external_entity_links` in the same migration, and pass it through `prepareExternalLink`, `ITicketExternalLinkView` and the REST schemas (create, inline, patch). `TicketExternalLinksSection` renders `title` when present, with the system label as the eyebrow, and otherwise keeps today's rendering. A citation needs a human title, and a free-text `metadata.title` would be invisible to the API contract. This is why it is a column rather than metadata.

### 2.3 Template storage

New child table `ticket_template_links`, modelled on `ticket_template_checklist_items`:

```
tenant uuid not null
template_link_id uuid not null default gen_random_uuid()
template_id uuid not null              -- FK (tenant, template_id) → ticket_templates ON DELETE CASCADE
system text not null                   -- registry key (built-in or custom:<slug>)
external_id text not null
realm text null
url text null                          -- stored absolute; never re-resolved at ticket creation
title text null
order_number integer not null default 0
metadata jsonb null                    -- e.g. { hudu: { article_id, company_id } } when picked via the EE picker
created_at / updated_at timestamptz
PRIMARY KEY (tenant, template_link_id)
UNIQUE (tenant, template_id, system, external_id)   -- created after distribution
```

- There is no `relationship` column, because template links are always `reference`: an origin or mirror on a template is meaningless, since it would claim identity with every ticket. There is no `portal_visible` column either (§6).
- Register the table everywhere a tenant table is registered. Checklist items are the model: `packages/db/src/lib/tenantTableMetadata.ts:134`, `tenantTableManifest.ts:520`, `tenantTableForeignKeys.ts:1029-1030`, and `ee/temporal-workflows/src/activities/tenant-deletion-activities.ts:300`.
- Schema: add `links: z.array(templateLinkSchema).max(50).default([])` to `ticketTemplateInputSchema`, where `templateLinkSchema` is `{system, external_id, realm?, url?, title?, metadata?}`, strict. Add the same field to `createTicketTemplateSchema`/`updateTicketTemplateSchema` (`server/src/lib/api/schemas/ticketTemplate.ts`), with the same "keep the two in step" note. PUT replaces the template wholesale, so `links` replaces the stored list just as `checklist` does (`ticketTemplateActions.ts:358-360`).
- Save validation: `createTicketTemplate`/`updateTicketTemplate` validate each link with the same pure rules as tickets: system resolves, `safeExternalUrl`, and `assertLinkDestination`. Factor those rules out of `prepareExternalLink`, which today also does `requireTicket`/comment lookups, into a `validateLinkTarget(tenantSystems, input)` that both use. A broken template link is a save error. It never surfaces later as an occurrence failure.
- Reads: `toTemplate` and `ITicketTemplate` gain `links`. `GET /api/v1/tickets/templates/{id}` returns them through `getTicketTemplate`, which is the path MCP's `call_api_endpoint` uses. `loadTemplateForInstantiation` gains `links`. `getTicketTemplateForCreate` returns `links: {title, href, systemLabel}[]` so QuickAddTicket can preview them.
- Deleting a custom system: extend the in-use count (`externalLinkActions.ts:547-557`) to `ticket_template_links`. Otherwise a deleted `custom:` system would make every later instantiation fail `system_not_found`.

### 2.4 Template editor UI

Add a "Documentation links" `SectionCard` to `TicketTemplateEditor.tsx` between Checklist (`:622`) and Custom fields (`:670`). It holds an ordered list of `title · system · URL` with remove and reorder, and an "Add link" dialog that reuses the system select and fields from `TicketExternalLinksSection` (system grouping `:255-263`, realm label `:285`, client-side errors `:338-352`). Extract that form into a shared `ExternalLinkFields` component instead of copying it. In EE, when `hudu_integrations.is_active`, the dialog offers "Pick from Hudu", which calls `listHuduArticlesAcrossCompanies` with search and fills `system='hudu'`, `external_id=<article id>`, `url=<absolute url>`, `title=<article name>` and `metadata.hudu`. A pasted URL with `system='hudu'` uses the URL path as `external_id` and needs no Hudu call. The editor stays on the client-bundle guard (`ticketTemplateSchema.ts:1-2`). The Hudu picker is reached through the existing EE action-boundary pattern, never imported into CE code.

### 2.5 Copying at ticket creation

The one place the copy happens is `applyCreatedFromTemplateEffects`. It gains `links: readonly TemplateLinkInput[]`, and all three paths in §1.3 pass `template.links`:

- `instantiateTicketTemplate` → `createTicketWithSideEffects` input `templateLinks` → `applyCreatedFromTemplateEffects`.
- `addTicket` passes `sourceTemplate.links` at `ticketActions.ts:942`. Links are always copied. There is no form toggle like `copyChecklistFromTemplate`, because a technician who does not want a citation removes it from the ticket.

Inside it, call `persistExternalLinksForCreate(trx, tenant, ticketId, links.map(→ relationship 'reference'), actor)`. Two changes to that function are required:

1. **Layering.** `applyCreatedFromTemplateEffects` lives in `shared/services/tickets`, and `persistExternalLinksForCreate` lives in `packages/tickets`. Shared must not import `@alga-psa/tickets` (`shared/rmm/alerts/ticketCreatedEvent.ts:17` documents this rule). `externalLinkPersistence.ts` depends only on `@alga-psa/db`, `@alga-psa/types`, `shared/lib/ticketActivity` and the event bus, so it moves down to `shared/services/tickets/externalLinkPersistence.ts`. `packages/tickets/src/actions/externalLinks/externalLinkPersistence.ts` becomes a re-export, the same pattern `packages/tickets/src/lib/externalSystems.ts` already uses.
2. **Actor.** Replace the `createdBy: string | null` parameter with `CreateTicketActor` and use `resolveActorEffects(actor)` for both `created_by` and the activity actor/source. Today a recurring (system) ticket would record its link activity as `USER` with no user (`:404-407`).

Events: return the inserted rows from `applyCreatedFromTemplateEffects`/`createTicketWithSideEffects` and publish `TICKET_EXTERNAL_LINK_ADDED` after commit. `createTicketWithSideEffects` uses the same deferred publication for its other events, and `addTicket` publishes after its transaction.

The `TICKET_CREATED_FROM_TEMPLATE` activity details gain `links_copied: n` next to `checklist_items_copied` (`createTicketWithSideEffects.ts:141-146`).

Failure policy: template links were validated on save, and §2.1 removes cross-ticket conflicts. A remaining failure is a custom system deleted despite §2.3's guard, or a data repair, and it surfaces as `ExternalLinkValidationError`. On the recurring path, `instantiateTicketTemplate` maps it to `TicketTemplateInstantiationError('INVALID_REFERENCES')`, so the occurrence records a readable failed reason and retries after the template is fixed. Silently dropping a link the customer configured is worse than a visible failed occurrence.

### 2.6 Recurring-definition override semantics

v1 has no link overrides. Links come from the template only. That meets the done criterion, and Joymode's request is per renewal procedure (that is, per template), not per client.

The semantics are fixed now so a later addition does not change storage. A `links` group would join `recurringTicketOverridesSchema` and follow the existing group rule (`effectiveFields.ts:57-77`): when present, it replaces the template's links as a unit (an empty array means "no links"); when absent, it inherits. The definition layer applies first, then the client layer. This is the same fold, and `resolveTemplateTicketFields` would return links alongside the scalar fields. There is no append mode: a mode flag on one group is the friction signal, and replace-as-unit is the rule every other group follows. The main use case for an override is a per-client Hudu article in a tenant-wide template, which is exactly a client-layer replace.

### 2.7 Storing versus resolving Hudu URLs

- The template stores the absolute URL at save time, together with the Hudu ids in `metadata.hudu` when picked. Ticket creation copies the stored values verbatim and never contacts Hudu or reads `hudu_integrations`. The recurring generator therefore has no Hudu dependency, and a Hudu outage or disconnected integration cannot fail an occurrence.
- The only live Hudu call is the editor's picker (§2.4), which runs on the template save path and is user-initiated.
- Pasted Hudu URLs are validated syntactically (`safeExternalUrl`). If the EE integration is connected and the URL's host differs from `hudu_integrations.base_url`, the editor shows a non-blocking warning, based on a DB read only.
- Staleness: an article that is renamed or moved in Hudu leaves the stored URL or title stale. Re-picking in the editor refreshes it. There is no background re-validation (§6).

### 2.8 Dedupe and idempotency

- Template: `UNIQUE (tenant, template_id, system, external_id)`. The schema also rejects duplicates in one payload, with a precise 400 instead of a 23505.
- Ticket: §2.1's per-entity reference index. A single template cannot produce a duplicate on one ticket, because the template is already deduped.
- Recurring: the occurrence ledger (`generateRecurringTicketsForTenant.ts:330-362`, `onConflict(IDEMPOTENCY_COLUMNS).ignore()`) guarantees one ticket per occurrence. Links are written in the same transaction as the ticket and the `finish({status:'created'})` row, so a failed attempt rolls back ticket and links together, and a retry starts clean. A later edit to a template does not touch tickets already generated, because links are a snapshot like checklist items (R6).

## 3. API and MCP surface

- `GET/POST/PUT /api/v1/tickets/templates[/{id}]`: `links` array. Update the OpenAPI registration for template routes alongside `server/src/lib/api/openapi/routes/workManagementV1.ts`, so `search_api_registry` exposes the field to MCP.
- `POST /api/v1/tickets/templates/{id}/instantiate`: no new input. The response ticket has the links. Callers read them from `GET /api/v1/tickets/{id}/external-links`.
- `/api/v1/tickets/{id}/external-links`: request and response gain `title`. Relationship-scoped uniqueness is a behaviour change. Document that a `reference` may now appear on several tickets.

## 4. Tests

Unit:
- `ticketTemplateSchema`: links accepted and stripped to shape; bad URL, unknown key, duplicate `(system, external_id)` and more than 50 links rejected; `relationship` not accepted.
- `validateLinkTarget`: the same cases as `prepareExternalLink` without the ticket lookup. The existing `prepareExternalLink` tests keep passing.
- `instantiateTicketTemplate.clientScope.test.ts` pattern: `createTicketWithSideEffects` receives `templateLinks` in template order.
- `applyCreatedFromTemplateEffects`: a system actor yields `created_by null` and a system activity actor; `links_copied` is recorded.
- `insertExternalLink` pre-check: a reference duplicate on another entity is allowed, a reference duplicate on the same entity is rejected, and a mirror duplicate on another entity is still rejected.
- `TicketExternalLinksSection` render: a title is shown when present, and the fallback is unchanged.
- `TicketTemplateEditor`: add, remove and reorder links; the client-bundle guard test still passes.

Integration (DB, `server/src/test/integration/`):
- Migration: the old index is gone and the two partial indexes exist. Two tickets with the same `hudu`/article reference both insert. Two `mirror` rows for the same record on different tickets fail with 23505.
- `ticketTemplates`: create and update with links, wholesale replace on PUT, cascade on template delete, uniqueness.
- Recurring end to end (the done criterion): template with a Hudu link → definition with two clients and two occurrences → generator → each ticket has one `reference` link with the URL and title, a system activity actor and `links_copied: 1`. Rerunning the generator adds nothing. Deleting the template link afterwards leaves existing tickets unchanged.
- REST instantiate: the created ticket's `/external-links` returns the template link.
- `addTicket` with a template: links copied, and the event published after commit.
- Deleting a custom system used only by a template link is rejected with `system_in_use`.
- No Hudu call during generation: run the generator with the Hudu client mocked to throw and assert that tickets are created.

EE unit: the picker fills `system/external_id/url/title/metadata.hudu` from a `listHuduArticlesAcrossCompanies` item, and the host-mismatch warning is driven by `base_url`.

## 5. Order of work

1. Migration: the index change from §2.1, `external_entity_links.title`, the `ticket_template_links` table, and the tenant-table registrations.
2. Move `externalLinkPersistence` to shared, change the actor parameter, add the relationship-scoped pre-check and `validateLinkTarget`.
3. The `hudu` built-in system and `title` through the link view and API.
4. Template schema, actions and REST/OpenAPI.
5. Copying in `applyCreatedFromTemplateEffects`, wired into the three paths, with events.
6. Editor section and the EE Hudu picker.
7. Tests from §4.

## 6. Out of scope

- Live Hudu resolution, existence checks or background re-validation of stored URLs.
- Per-client resolution of a tenant-wide template link to each client's Hudu company article. The override in §2.6 is the future mechanism.
- Recurring-definition and client link overrides in v1 (semantics fixed in §2.6).
- Portal-visible template links. Copied links are private, matching `persistExternalLinksForCreate`. Sharing stays an explicit, authorized per-ticket action.
- Comment-level links on templates, and `origin`/`mirror` relationships on templates.
- Copying links into a template by "Create template from ticket" (`ticketActions.ts:1373`). That needs its own decision about which of a ticket's references are template-worthy.
- Back-filling links onto tickets generated before a link was added to their template.
- Co-managed (shared) tickets. Their data source exposes no external links (`server/src/lib/co-managed/sharedTicketDataSource.ts:222`).

## 7. Where the plan and the code disagree

- **M1. No implementation on this branch.** The order says "the implementation already exists at this HEAD". It does not: the branch is at `0184722cd6` (origin/main), with no commits of its own and no template-link code anywhere (`grep links` over the template schema, actions and migrations finds nothing).
- **M2. Tenant-wide uniqueness of external links** (`20260913120000_create_external_entity_links.cjs:108-113`, `externalLinkPersistence.ts:288-302`). Copying a template link onto generated tickets would fail every occurrence after the first. The plan changes the rule (§2.1) instead of working around it, for example with per-ticket synthetic `external_id`s.
- **M3. "instantiateTicketTemplate covers manual use."** It does not. In-app manual creation goes through `addTicket` (`ticketActions.ts:785-958`), and only the recurring generator and REST instantiate call `instantiateTicketTemplate`. The copy therefore belongs in `applyCreatedFromTemplateEffects`, the one function all three paths share. `ticketActions.ts:836` already carries `// LEVERAGE: friction ticket-create-composition` for this divergence.
- **M4. `persistExternalLinksForCreate` assumes a user actor** (`externalLinkPersistence.ts:404-407`) and lives above the shared layer that needs it. Both are fixed in §2.5.
- **M5. Hudu is not a known external system, and links have no title.** Without §2.2 a Hudu link would render as "External Reference · <path>".
- **M6. Hudu article URLs come only from a live API call** (`huduGlobalDocsActions.ts:102-103`). The integration caches companies, not articles, so "resolve on the hot path from cached mappings" is not possible. The plan stores the URL at save time (§2.7).
