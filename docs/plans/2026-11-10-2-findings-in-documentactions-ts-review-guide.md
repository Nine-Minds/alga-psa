# Human review guide — document association authorization

Plan followed: [2026-11-10 fix plan](./2026-11-10-2-findings-in-documentactions-ts-fix-plan.md), committed as `9ff538d5cb`.

## Finding 1 — association search disclosed cross-client records and counts

**Confirmed vulnerable path.** `searchDocumentAssociationEntities` had a tenant-wide `document:read` gate, then each entity branch counted and paged tenant rows without checking the caller's entity permission or client/record scope. A client user could search by another client's task, ticket, or client name and receive both identifiers/labels and a tenant-wide count.

**Repair.** The target adapter in `shared/lib/documentAssociationTargetAuthorization.ts` now checks entity read permission and scopes every supported search branch before the branch's count clone and pagination. It resolves client ownership for direct and joined records, applies ticket portal-board visibility through `canAccessAttachmentTicket`, and applies project and asset record authorization. Internal MSP principals retain cross-client results subject to the entity read permission. The same entity-to-client ownership mapping now feeds document relationship authorization in `shared/lib/documentAuthorization.ts`.

**Behavioral regression and observed result.** `server/src/test/integration/documentAssociationCrossClient.integration.test.ts` seeds two clients with projects/tasks and a ticket. Its DB-backed case asserts Client A gets no Client B task, client, or ticket result and a zero count, can still find its own task, and that an MSP principal still sees both clients' tasks. `TEST_DB_NAME=test_document_actions_authz_4477 npx vitest run src/test/integration/documentAssociationCrossClient.integration.test.ts --coverage.enabled=false` passed: 1 integration test.

## Finding 2 — association writes accepted unauthorized targets

**Confirmed vulnerable path.** `uploadDocument` accepted caller-supplied target IDs after a general `document:create` grant, while `createDocumentAssociations` and `removeDocumentAssociations` authorized only the document set. A client could attach to or detach from another client's entity; client uploads are client-visible, so the new association could expose the file to the target client's portal.

**Repair.** The shared target adapter resolves and authorizes target records inside the same transaction as association writes. `createDocumentAssociations` and `removeDocumentAssociations` check both the target and document set before writing. `uploadDocument` checks all requested targets before storage/folder work and rechecks inside the transaction before inserting the document or associations. Its coarse `canUploadDocument` check no longer lets `document:create` stand in for target authorization. Supported association kinds include the picker entities and the additional entity types accepted by the association API; unknown types fail closed.

**Behavioral regression and observed result.** The same integration case verifies:

- Client A's upload to Client B's task is denied; no document, association, or folder row is added.
- Client A cannot create or remove an association on Client B's task; persisted association rows remain unchanged.
- A Client B document cannot be associated with Client A's authorized task, preserving document-level authorization.
- Client A can create/remove an association to its own task, and the MSP can associate Client A's document with Client B's task.
- The MSP can upload a document to Client B's task and the document plus association persist.
- The attempted cross-client upload does not appear in Client B's `getClientDocuments` result.

The same isolated database-backed run passed: 1 integration test, including persisted-state assertions for denied operations and successful MSP upload. The existing authorization contract suite also passed: 3 files, 10 tests.

## Review first

1. Inspect `shared/lib/documentAssociationTargetAuthorization.ts`, especially ticket board checks, project-task authorization, contract ownership, and the fail-closed behavior for unmapped types.
2. Inspect the transaction boundaries in `uploadDocument`, `createDocumentAssociations`, and `removeDocumentAssociations`; confirm denied uploads cannot leave storage, document, association, or folder state behind.
3. Inspect the document-to-client resolver handoff in `shared/lib/documentAuthorization.ts`, including multi-client contract associations.
4. Review the integration fixture and persisted-state assertions in `server/src/test/integration/documentAssociationCrossClient.integration.test.ts`.

## Uncertainty / unverified behavior

- The full `server` TypeScript check did not finish: `tsc --noEmit -p tsconfig.json` exhausted the available heap at 4 GB and again at 8 GB. The `packages/documents` and `shared` workspace typechecks are run separately and their outcomes are recorded in `draftSummary`.
- The integration case covers project-task, client, and ticket search scopes plus upload/associate/remove. Other entity adapter branches compile and share the same ownership resolver, but do not each have a dedicated persisted integration fixture in this draft.
- `getDocumentsByEntity` and `getDocumentCountsForEntities` remain outside this plan's requested read-surface scope, as identified in the approved plan.
