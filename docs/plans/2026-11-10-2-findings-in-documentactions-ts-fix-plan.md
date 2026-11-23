# Fix plan — 2 security findings in `documentActions.ts`

**Card:** Security: 2 findings in documentActions.ts (4477a520-1e14-5c5f-b6fa-7949e4f9d4e2)
**Source:** security review of PR #3987, merge `e75baf12b57c`
**Branch:** `feature/security-2-findings-in-documentactions-ts`
**Status of this document:** design only — no implementation exists on this branch yet.

Both findings are **confirmed real** against the code as it stands. They are two faces of one
missing control: **nothing authorizes the *association target entity* for a document operation.**
Document-level permission (`document:read` / `document:create` / `document:update`) and tenant
scoping are enforced everywhere, but the `(entity_type, entity_id)` a client user names — a task,
a client, a ticket — is never checked against that user's own client. Because a document's client
scope is *derived from its associations* (`shared/lib/documentAuthorization.ts:124-340`), an
attacker who can read or write an association across clients both enumerates and injects.

---

## 1. The defect, precisely

### Finding 1 — `searchDocumentAssociationEntities` enumerates every client's resources (high, authz)

`packages/documents/src/actions/documentActions.ts:1918-2145`.

- The only gate is a coarse tenant-wide check: `if (!await hasPermission(user, 'document', 'read'))`
  at line 1926. Client roles receive `document:read` by default
  (`server/migrations/utils/permissions/catalog.cjs:154-155`, confirmed: `client: true`,
  `defaultGrants.psa: ['client:Admin','client:Finance','client:User']`).
- Every entity branch then queries the entity's root table scoped **only by tenant**, with no
  client/record scope:
  - `client` → `clients` (lines 1961-1969)
  - `contact` → `contacts` (1971-1990)
  - `ticket` → `tickets` (1992-2016)
  - `asset` → `assets` (2018-2045)
  - `project_task` → `project_tasks → project_phases → projects → clients` (2047-2076)
  - `contract` → `contracts` (2078-2093)
  - `opportunity` → `opportunities` (2095-2119)
  - `quote` → `quotes` (2121-2143)
  Each returns `value` (the raw entity id) + a human label that concatenates the **owning client's
  name** and other operational metadata (task name, ticket number/title, asset serial, etc.).
- **Caller / input that reaches it:** the client portal upload picker. `AssociatedEntityPicker`
  calls `searchDocumentAssociationEntities(selectedSearchableEntityType, search, page, limit)`
  (`packages/documents/src/components/AssociatedEntityPicker.tsx:119`), and
  `DocumentUpload` lists `project_task`, `client`, `contact`, `ticket`, `asset`, `contract`,
  `opportunity` as upload targets (`packages/documents/src/components/DocumentUpload.tsx:73-81`).
- **Attack path:** a Client A portal user opens the document upload dialog, selects entity type
  `project_task` (or `client`/`ticket`/…), and pages through results. The response contains Client
  B's task ids and the label `"<task> - <project> - <Client B name>"`. Client A has now enumerated
  Client B's identifiers and operational metadata. The paginated `countRows` (lines 1954-1957)
  leaks the tenant-wide total as well.

### Finding 2 — client user can attach a client-visible document to another client's entity (high, authz)

`packages/documents/src/actions/documentActions.ts:2335-2642` (`uploadDocument`), with the same
hole in `createDocumentAssociations` (2148-2238) and `removeDocumentAssociations` (2241-2320+).

- `canUploadDocument` short-circuits: `const grants = await ticketDocumentGrants(user, 'create');
  if (grants.general) return true;` (`packages/documents/src/lib/documentPermissions.ts:87-93`).
  Client roles hold general `document:create` (`catalog.cjs:149-150`), so the function returns
  `true` **without ever looking at the target** (`projectTaskId`, `clientId`, …). The target-aware
  branch at lines 90-93 is only reached when the user *lacks* the general grant.
- `uploadDocument` then forces client uploads to be client-visible —
  `let isClientVisible = options.isClientVisible === true || user.user_type === 'client'`
  (line 2490) — and inserts the caller-supplied `projectTaskId` association with **no resolution or
  authorization of that task** (lines 2587-2594, written at 2624-2636 inside the transaction).
- `createDocumentAssociations` (2148) and `removeDocumentAssociations` (2241) gate on
  `document:update` (2157, 2250) and call `assertAuthorizedDocumentSetForMutation` (2172, 2268).
  But that helper authorizes **only the document set** (`documentActions.ts:366-398` — it loads the
  documents and runs `authorizeAndRedactDocuments`); it never authorizes the `entity_id`/
  `entity_type` the documents are being attached to/detached from.
- **Attack path (chained with Finding 1):**
  1. Client A obtains a Client B `project_task` id from `searchDocumentAssociationEntities`.
  2. Client A calls `uploadDocument` with `projectTaskId = <Client B task>`. `canUploadDocument`
     returns `true`; the document is created `is_client_visible = true` and associated to B's task.
  3. `resolveDocumentAuthorizationRecords` derives the document's `clientId` from the
     `project_task` association via `project_tasks → project_phases → projects.client_id`
     (`shared/lib/documentAuthorization.ts:199-207, 301-303, 325-327`), yielding **Client B**.
  4. The `same_client` relationship rule
     (`packages/authorization/src/kernel/relationshipTemplates.ts:161`) now authorizes **Client B**
     portal users to read the attacker-controlled document. Confirmed end-to-end: Client A injects a
     document into Client B's workspace, and B's users receive it.
- The same missing check lets Client A **remove** B's associations via `removeDocumentAssociations`
  and attach to any `client`/`ticket`/`contact`/`asset`/`contract`/`opportunity` of B's.

**Internal users are not the concern** — MSP (`user_type !== 'client'`) staff legitimately associate
documents across clients, and `getDocumentBuiltinRelationshipRules` returns `[]` (allow-all) for them
(`shared/lib/documentAuthorization.ts:116`). The fix must deny **client principals** reaching
out of their own client, and must not regress internal/system upload paths.

Neither defect was introduced by PR #3987; both pre-exist on the adjacent document paths, as the
finding notes.

---

## 2. The fix

### 2a. The general mechanism (CLAUDE.md "prefer the general solution")

Both findings are "the association target is unauthorized." Build **one entity-authorization
adapter** keyed by `entity_type`, and consume it from every surface, rather than hand-rolling a
client filter in nine `if` branches and three mutation sites.

Home: `shared/lib/documentAuthorization.ts` already owns the per-entity → `client_id` join logic
(`resolveDocumentAuthorizationRecords`, lines 124-340, covering `client`, `contact`, `ticket`,
`project_task`, `contract`, `quote`, `invoice`, `sales_order`). Extract that mapping into a reusable
registry so it is written once:

```
// shared/lib/documentAssociationTargetAuthorization.ts  (new)
export const ASSOCIATION_TARGET_ADAPTERS: Record<EntityType, {
  permissionResource: string;              // 'client' | 'ticket' | 'project' | 'asset' | ...
  // Constrain a root query of this entity to the subject's client (client users only).
  applyClientScope(query, trx, tenant, user): void;
  // Point check: may this user target this specific entity id for `action`?
  assertTarget(trx, tenant, user, entityId, action): Promise<void /* throws on deny */>;
}>
```

- For client users `applyClientScope` adds `entity.client_id = user.clientId` (for `project_task`,
  the join to `projects.client_id`; for `ticket`, reuse `applyPublicCommentAttachmentFilter` /
  `canAccessAttachmentTicket` at `shared/lib/ticketCommentAttachments.ts:94,123` so portal board
  visibility is preserved; for `quote`/`opportunity`, `client_id = user.clientId`). For internal
  users it is a no-op.
- `assertTarget` reuses the existing per-type authorizers where they exist rather than re-deriving:
  `canAccessAttachmentTicket` (ticket), the project authorizer
  `createProjectReadAuthorizer`/`assertProjectReadAllowed`
  (`packages/projects/src/lib/projectReadAuthorization.ts:102,146`) for `project_task`,
  `filterReadableAssets` (`packages/authorization/src/assetReadAuthorization.ts:174`) for `asset`,
  and the kernel `same_client` evaluation for the remainder. `opportunity` has **no** existing
  client-scope helper (confirmed gap) — add its `opportunities.client_id` scope here, and
  fail-closed (deny for client users) for any entity type not in the registry.

This single registry is the choke point both findings need. Adding it also hardens the sibling
read surface `getDocumentsByEntity` (`documentActions.ts:1642`) and
`getDocumentCountsForEntities` (`documentActions.ts:1565`), which have the same coarse-only gate —
see scope note in §4.

### 2b. Finding 1 — scope the search

In `searchDocumentAssociationEntities` (`documentActions.ts:1918-2145`): after the existing
`document:read` gate, apply `ASSOCIATION_TARGET_ADAPTERS[entityType].applyClientScope(...)` to
**both** the result query and the `countRows` query in every branch (the count is a `.clone()` of
the same query at line 1955, so scoping the base query before cloning covers both). For client
principals this constrains each entity to `user.clientId` (+ board visibility for tickets). For
MSP principals, additionally require the per-entity coarse read permission
(`ASSOCIATION_TARGET_ADAPTERS[entityType].permissionResource`) as defense-in-depth; the
high-severity leak is the client cross-client case, so client scoping is the load-bearing change.

### 2c. Finding 2 — one transaction-scoped association boundary

Add `assertAuthorizedAssociationTarget(trx, tenant, user, entityType, entityId, action)` (thin
wrapper over `ASSOCIATION_TARGET_ADAPTERS[*].assertTarget`) and call it **inside the existing
transaction, before any association or folder write**, at all three mutation sites:

- `uploadDocument` (`documentActions.ts:2537-2636`): for **each** target present in `options`
  (`ticketId`, `clientId`, `contactNameId`, `assetId`, `projectTaskId`, `contractId`,
  `opportunityId`, `parentDocumentId`), assert the target with action `update`/`create` before
  `DocumentAssociation.create`. Place it ahead of the folder-provisioning/visibility logic
  (2435-2518) so a denied target also cannot trigger folder side effects.
- `createDocumentAssociations` (`documentActions.ts:2171-2188`): assert `(entity_type, entity_id)`
  alongside the existing `assertAuthorizedDocumentSetForMutation` call.
- `removeDocumentAssociations` (`documentActions.ts:2256-2281`): assert the target before
  `query.delete()`.

Also correct `canUploadDocument` (`documentPermissions.ts:87-93`) so the general `document:create`
grant no longer short-circuits past target validation for non-ticket targets — but the transaction
boundary is the **authoritative, unbypassable** enforcement point (every association write funnels
through these three functions and `DocumentAssociation.create`); `canUploadDocument` remains a
coarse early-reject only.

Because enforcement sits at the association write inside the DB transaction, no alternate caller
(API route, workflow, future UI) can reach the write without passing it.

---

## 3. The proof (regression tests)

Model: `server/src/test/integration/clientPortalDocuments.integration.test.ts` — a DB-backed vitest
integration harness that seeds a tenant with multiple clients/users via
`createTenant`/`createClient`/`createUser` (`server/test-utils/testDataFactory`), swaps the current
user with `setMockUser`, and invokes the real server actions against a live test DB. It already
contains "T017: Client A cannot see client B's documents," so the two-client fixture and the action
plumbing exist. Add a sibling file, e.g.
`server/src/test/integration/documentAssociationCrossClient.integration.test.ts`.

Each test **fails before the fix** because today nothing authorizes the target entity.

1. **Search is scoped (Finding 1).** Seed Client A + Client B, each with a `project_task` under a
   project (and a representative `client`, `ticket`, `contract`, `opportunity`). Acting as a
   Client A portal user (`user_type: 'client'`, `clientId = A`, holding default `document:read`),
   call `searchDocumentAssociationEntities('project_task', '<B task name>', 1, 50)`.
   - Assert `options` contains **none** of Client B's ids and `total === 0`.
   - Assert the positive case still works: searching A's own task returns it.
   - Before fix: returns B's task id + `"... - Client B"` label (fails). Repeat the negative
     assertion for `client` and `ticket` to cover the adapter's two scoping shapes
     (direct `client_id` vs ticket board visibility).

2. **Cross-client upload is rejected (Finding 2).** Acting as Client A, call `uploadDocument` with a
   FormData file and `options.projectTaskId = <Client B task>`.
   - Assert the result is a `permissionError` (or throws), **no** `documents` row is created, and
     **no** `document_associations` row references B's task.
   - Before fix: `canUploadDocument` returns `true`, the document is inserted `is_client_visible=1`,
     and the association row exists (fails).

3. **Leak is closed end-to-end (Finding 2 impact).** In the same fixture, after the (now rejected)
   upload attempt, act as a **Client B** portal user and call `getClientDocuments`.
   - Assert the attacker document does **not** appear.
   - This is the behavioral statement of the vulnerability: pre-fix (bypassing the guard by inserting
     the association directly, to model the old `uploadDocument`) B sees the document; post-fix the
     association never exists so B sees nothing.

4. **Associate / remove are rejected (Finding 2 siblings).** Acting as Client A, call
   `createDocumentAssociations(<B task id>, 'project_task', [ownDocId])` and
   `removeDocumentAssociations(<B task id>, 'project_task')`.
   - Assert both return `permissionError` and leave `document_associations` unchanged.
   - Before fix: `assertAuthorizedDocumentSetForMutation` passes (A owns `ownDocId`) and the write
     proceeds (fails).

5. **No internal regression.** Acting as an **MSP** user (`user_type !== 'client'`) with document
   permissions, assert `uploadDocument`/`createDocumentAssociations` targeting either client's task
   still succeed, and `searchDocumentAssociationEntities` still returns both clients' entities.
   Guards the "deny client principals only" boundary against over-restriction.

---

## 4. Scope not covered, and risks for the reviewer

**Deliberately out of scope**

- **Sibling read surfaces.** `getDocumentsByEntity` (`documentActions.ts:1642`) and
  `getDocumentCountsForEntities` (`documentActions.ts:1565`) share the coarse-only gate and should
  adopt the same adapter. The adapter is built so this is a small follow-on, but it is **not part of
  the two findings**; flagging it for the reviewer to fold in or spin out. (The per-document
  `same_client` kernel gate partially backstops these reads, but — like the search — it does not
  cover entity types absent from `resolveDocumentAuthorizationRecords`, e.g. `opportunity`.)
- **MSP-side per-entity read permissions in search.** Treated as defense-in-depth, not the fix; if
  it risks breaking internal pickers it can be deferred without reopening the high-severity hole.
- **Broad authorization-kernel refactor.** The adapter reuses existing per-type authorizers; it does
  not restructure the kernel.

**Risks / regressions to weigh**

- **Over-restriction of internal flows.** System/workflow/automation uploads and MSP staff must keep
  cross-client ability. The deny must key on `user_type === 'client'` (and preserve the
  `getDocumentBuiltinRelationshipRules` allow-all for internal users). Test 5 guards this.
- **Ticket board visibility.** Tickets are *not* a plain `same_client` check — `canAccessAttachmentTicket`
  additionally enforces the contact's portal visibility group/board
  (`shared/lib/ticketCommentAttachments.ts:123-170`). The adapter must route `ticket` through that
  helper, not a bare `client_id` compare, or it will both over- and under-authorize.
- **`opportunity` (and `quote`) have no existing client-scope helper.** The adapter must add their
  `client_id` scope explicitly and fail-closed for client users on any unmapped type, or the leak
  persists for those branches.
- **Performance.** The boundary adds one lookup per association target per mutation and one scoped
  join per search branch — negligible, all indexed by tenant/client/id.
- **Contract test drift.** The existing source-text contract tests
  (`documentActionsAssociationSearchTenantScoped.contract.test.ts`,
  `documentActionsUploadAssociationsTenantScoped.contract.test.ts`,
  `documentActions.authorization.contract.test.ts`) assert on exact `tenantScopedTable(...)` strings
  and section boundaries; edits to the search/upload bodies will require updating those string
  assertions in lockstep.
