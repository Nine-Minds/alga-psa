# Human review guide — document association authorization

Plan followed: [2026-11-10 fix plan](./2026-11-10-2-findings-in-documentactions-ts-fix-plan.md), committed as `9ff538d5cb`.

## Finding 1 — association search disclosed cross-client records and counts

**Confirmed vulnerable path.** `searchDocumentAssociationEntities` had a tenant-wide `document:read` gate, then each entity branch counted and paged tenant rows without checking the caller's entity permission or client/record scope. A client user could search by another client's task, ticket, or client name and receive both identifiers/labels and a tenant-wide count.

**Repair.** The target adapter in `shared/lib/documentAssociationTargetAuthorization.ts` checks entity read permission and scopes every supported search branch before count cloning and pagination. Ticket filtering uses the shared SQL portal visibility predicate, so client and board/contact scope applies in the query that supplies both rows and count. Contracts and quotes use `billing` permissions; opportunities use `opportunities`. Internal MSP principals retain cross-client results subject to the actual entity permissions. The same entity-to-client ownership mapping feeds document relationship authorization in `shared/lib/documentAuthorization.ts`.

**Behavioral regression and observed result.** `server/src/test/integration/documentAssociationCrossClient.integration.test.ts` seeds two clients, records across the affected search branches, and a visibility group with allowed and blocked ticket boards. Faithful permission grant sets exercise entity RBAC. The DB-backed cases assert cross-client records and counts are hidden, blocked-board tickets do not affect results or counts, and visible-board pagination keeps the scoped total. An MSP granted `billing` and `opportunities` permissions can search contracts, quotes, and opportunities. The isolated integration command passed: 3 tests.

## Finding 2 — association writes accepted unauthorized targets

**Confirmed vulnerable path.** `uploadDocument` accepted caller-supplied target IDs after a general `document:create` grant, while `createDocumentAssociations` and `removeDocumentAssociations` authorized only the document set. A client could attach to or detach from another client's entity; client uploads are client-visible, so the new association could expose the file to the target client's portal.

**Repair.** The shared target adapter resolves and authorizes target records inside the same transaction as association writes. Mutation checks require `document:update` and evaluate the document relationship/bundle policy for the `update` action; the document target adapter does the same. Parent-document uploads pass through this update gate. Upload performs an early authorization check, then rechecks inside the final transaction; entity-folder provisioning, folder visibility lookup, document insertion, and associations now share that transaction. If late authorization or a later write fails, database state rolls back and the uploaded storage object is cleaned up. Supported association kinds include the picker entities and the additional entity types accepted by the association API; unknown types fail closed.

Asset targets also require the existing asset record-read policy after coarse `asset:update` permission. Contract target checks confirm a `contracts` row exists; client principals additionally need a `client_contracts` assignment to their client, while MSP principals may target existing unassigned contracts. Both folder provisioning helpers use conflict-safe inserts inside the upload transaction so a duplicate folder race does not leave PostgreSQL's transaction aborted.

**Behavioral regression and observed result.** The same integration case verifies:

- Client A's upload to Client B's task is denied; no document, association, or folder row is added.
- Client A cannot create or remove an association on Client B's task; persisted association rows remain unchanged.
- A Client B document cannot be associated with Client A's authorized task, preserving document-level authorization.
- Client A can create/remove an association to its own task, and the MSP can associate Client A's document with Client B's task.
- The MSP can upload a document to Client B's task and the document plus association persist.
- The attempted cross-client upload does not appear in Client B's `getClientDocuments` result.
- With `document:read` and `document:create` but without `document:update`, Client A can read the existing document but create/remove association and parent-document upload requests are denied without state changes.
- If a task changes client scope after the upload's early check and storage upload, the final transaction denies the upload; no folder, document, or association persists, and `deleteFile` is called for the uploaded object.
- The search test verifies visible and blocked ticket boards, scoped count values, and two-page pagination. MSP contract, quote, and opportunity search and association operations succeed with faithful grants.
- With `asset:update` granted but an asset `same_team` record policy denying access, both association creation and removal are denied; removal preserves the persisted row.
- A client with coarse document read/update permissions can read a document, but a document `update` bundle rule denies association creation/removal and parent-document upload with no persisted changes.
- An MSP can associate to an existing unassigned contract; a nonexistent contract target is denied.
- Two uploads released through a shared storage barrier both complete their first entity-folder initialization. Both documents, task associations, four default folders, and external storage rows persist, and uploaded files are not cleaned up on success.

The isolated run `TEST_DB_NAME=test_document_actions_authz_4477 npx vitest run src/test/integration/documentAssociationCrossClient.integration.test.ts --coverage.enabled=false` passed: 6 integration tests. The existing authorization contract suite passed: 3 files, 10 tests.

## Review first

1. Inspect the permission-resource mapping, contract existence/client assignment split, asset record policy, and shared ticket SQL scope in `shared/lib/documentAssociationTargetAuthorization.ts`.
2. Inspect update-action authorization in `assertAuthorizedDocumentSetForMutation`, the document target adapter, and the parent-document upload path; check the read-allowed/update-denied regression.
3. Trace both folder helpers' conflict-safe inserts and the concurrent-upload regression, then verify folder, document, association, and storage outcomes.
4. Review the permission-grant fixtures and persisted outcomes in `server/src/test/integration/documentAssociationCrossClient.integration.test.ts`.

## Uncertainty / unverified behavior

- The full `server` TypeScript check did not finish: `NODE_OPTIONS=--max-old-space-size=4096 npm run typecheck -w server` exhausted the 4 GB heap on this revision; an earlier 8 GB attempt also exhausted heap. The focused `packages/documents` and `shared` workspace typechecks passed, as did the documents build.
- The integration case verifies the corrected billing/opportunities permission resources behaviorally, but does not seed every supported association target type.
- `getDocumentsByEntity` and `getDocumentCountsForEntities` remain outside this plan's requested read-surface scope, as identified in the approved plan.
