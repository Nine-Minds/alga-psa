# KB article images readable in the client portal — design

Card: `db5eb198` — Client portal: uploaded images in KB articles are refused (403) for portal users
Ticket: alga-2026-0003229 (PBNJ, Phill Hodgkinson)
Step: Design Session (conn, delegated desk work), 2026-11-17

## Problem

A client-portal user who can read a published client-audience KB article gets `403` for every
image embedded in it. `GET /api/documents/view/<fileId>` → `getAuthorizedDocumentByFileId` →
`authorizeAndRedactDocuments` refuses the file because a non-MSP subject only carries the
built-in relationship rules `own` and `same_client` (`shared/lib/documentAuthorization.ts:61-67`),
and an inline KB image has no client of its own: `createDocumentFromCommittedFile` writes only a
`document` association to the parent article (`createDocumentFromCommittedFile.ts:376-382`), and
`resolveDocumentAuthorizationRecords` never derives a client from a `document` association
(`documentAuthorization.ts:212-291`). The render path is correct; the authorization path has no
rule for "content readable by every client that can read its published article".

`packages/documents/src/lib/editorImageUpload.ts:126-137` records this as an open decision.
This design makes that decision.

## Decision

Add the missing rule as a **first-class relationship template in the authorization kernel**, not
as a special case in the file route:

`readable_via_published_parent` — a document is readable by a client subject when a `document`
association points at a parent document that is the `document_id` of a `kb_articles` row with
`status = 'published'` and `audience in ('client','public')`, and the child document is
`is_client_visible`.

Rationale (general over specific): the kernel already owns the two facets of every rule — a JS
record facet and an SQL facet generated from the same registry entry
(`packages/authorization/src/kernel/relationshipTemplates.ts:1-35`). Expressing the rule there
means the file route, the document list, the folder tree and any future consumer get the same
answer, and the two facets cannot drift. A bypass in `getAuthorizedDocumentByFileId` would fix the
`<img>` and leave every list/count disagreeing with it; a stored client association on upload has
nothing to point at (the article is tenant-wide, not per-client).

Two alternatives considered and rejected:

- **Route-level exception** in `server/src/app/api/documents/view/[fileId]/route.ts` — smallest
  diff, wrong layer, leaves the SQL facet inconsistent and silently bypasses the kernel.
- **Associating the image to a client at upload** — impossible in general: the article has no
  client, and "every client" is exactly the case the kernel lacks a template for. It would also
  hand every client of the tenant access to the image regardless of the article's audience or
  publication state.

## Mechanism

### 1. Kernel: a new template with both facets

- `packages/authorization/src/kernel/contracts.ts`: add `'readable_via_published_parent'` to
  `RelationshipTemplateKey`.
- `packages/authorization/src/kernel/relationshipTemplates.ts`: register the template.
  - `matches(record)` → `record.readableViaPublishedParent === true` (fail-closed on anything else,
    including `undefined`). This mirrors how a document-specific facet such as `attachedTickets`
    is carried on `AuthorizationRecord` (`contracts.ts:54-70` already allows resource facets).
  - `compileSql(builder, _scope, adapter)` → `adapter.applyReadableViaPublishedParent(builder)`;
    when the adapter does not implement it, emit `1 = 0` (the same fail-closed convention
    `denyUnless` uses for empty lists).
- `RelationshipSqlAdapter` (same file): optional
  `applyReadableViaPublishedParent?(builder: Knex.QueryBuilder): void`.

Because the registry is keyed and compile-checked, adding the key without a definition is a
compile error — the two facets cannot be added half-way.

### 2. Document resource: populate the record facet and the SQL facet

`shared/lib/documentAuthorization.ts`:

- `getDocumentBuiltinRelationshipRules` (`:61-67`): non-MSP subjects get
  `[{template:'own'}, {template:'same_client'}, {template:'readable_via_published_parent'}]`.
  MSP subjects stay `[]` — their access is unchanged, which is one of the acceptance criteria.
- `resolveDocumentAuthorizationRecords` (`:69-294`): collect `document`-type associations
  (today ignored) into `parentDocumentIds`, then one batched query:
  `kb_articles where tenant = ? and status = 'published' and audience in ('client','public') and
  document_id in (...)`. Set `readableViaPublishedParent: true` on the record for those children.
  A `document` association is a general parent pointer; the article table decides whether the
  parent makes the child client-readable, so no new column and no backfill is needed.
- `createDocumentRelationshipSqlAdapter` (`:478-561`): implement
  `applyReadableViaPublishedParent(builder)` as an `EXISTS` over
  `document_associations` (`entity_type = 'document'`, `entity_id` = the parent document, tenant
  matched) joined to `kb_articles` on the same tenant with `status = 'published'` and
  `audience in ('client','public')`. This is the SQL half of the same rule, so list narrowing,
  counts and pagination agree with the record facet.

### 3. What is deliberately NOT widened

- **Writes.** The rule is a *built-in read* rule only. `authorizeAndRedactDocumentsForAction`
  still evaluates `authorizeMutation` for `update`/`delete`; client subjects hold no document
  write rules, so an image stays read-only to them. A test pins this.
- **Visibility.** The existing client-visibility gate (`:419-424`) still refuses a non-owned
  document with `is_client_visible !== true` for client users. The template requires it again in
  the SQL facet. Internal-audience images keep their current behaviour: they are only reachable
  through rules MSP users satisfy.
- **Publication state.** `status = 'published'` means drafts and unpublished articles grant
  nothing, so unpublishing revokes access on the next request. Nothing is cached or stored: the
  rule is computed per request from the article row, so there is no grant table to backfill or
  clean up, and no migration.
- **Cross-tenant / anonymous.** Tenant scoping is unchanged (`tenantScopedTable`,
  `tenantDb.tenantJoin`); the route already 401s unauthenticated callers before this code runs.
- **Other 403 media (avatars, team/client logos, non-KB editor images).** Out of scope, separate
  follow-up card: those documents have no published client-audience parent article, so this rule
  does not touch them.

## Acceptance mapping

| Accept criterion | Covered by |
| --- | --- |
| Portal user reads images of a published client-audience article (200) | record facet + route unchanged |
| 403 for internal-audience, draft, unpublished articles | `status`/`audience` filters in both facets |
| 403 for another tenant | tenant predicates in both facets |
| Pre-existing images (e.g. PBNJ file 37be607e) work with no re-upload | rule is computed from the existing parent association; no data change |
| MSP access unchanged | `getDocumentBuiltinRelationshipRules` returns `[]` for MSP |
| Test through the real authorization path | tests below |

## Tests

1. **Record facet** (`shared/lib/__tests__/documentAuthorization.readableViaPublishedParent.test.ts`
   or the package's existing location): a child document of a published `client` article is marked
   readable; `internal` audience, `draft`, `archived`, and a parent with no `kb_articles` row are
   not; the batch query is tenant-scoped.
2. **SQL facet**: the adapter's `EXISTS` compiles and narrows a `documents` query to the same set
   as the record facet (allowed and refused cases), so list/count paths agree.
3. **Real path, client subject** (integration, `getAuthorizedDocumentByFileId`): 200-equivalent
   `IDocument` for the image of a published client article; `null` for the same image when the
   article is `internal` or `draft`; `null` for a client of another tenant.
4. **Mutation guard**: `authorizeAndRedactDocumentsForAction(..., 'update')` returns nothing for
   the client subject on that image.
5. **MSP regression**: an MSP user still reads the same image, and still reads internal-audience
   images.
6. Optional UI-level: extend `ClientKBArticleView.images.test.tsx` is *not* enough (it mocks the
   fetch); keep the proof at the action/integration layer.

## Risks / notes for implementation

- `getAuthorizedDocumentByFileId` (`documentActions.ts:260-277`) first narrows by
  `applyDocumentProductReadScope` (`packages/documents/src/lib/documentPermissions.ts:11-35`),
  which is RBAC-shaped, not record-shaped: a co-managed tenant requires an explicit `document`
  read grant. Confirm the portal client role satisfies it in the integration test; if it does not,
  that is a separate, pre-existing gate and must be reported rather than folded into this rule.
- The rule is per-request; no migration, no backfill, no change to `editorImageUpload.ts` upload
  behaviour (images stay `isClientVisible: true` with a `parentDocumentId`). Its open-decision
  comment should be updated to point at this rule.
- `document`-type associations exist for other parent-child cases (e.g. generated previews). The
  article join keeps the rule narrow: only a published client/public article parent grants.
