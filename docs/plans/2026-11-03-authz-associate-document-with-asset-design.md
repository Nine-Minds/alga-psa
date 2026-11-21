# Design — authorize record-level access in asset/document association mutations

Card: `626bfef9-5d64-51aa-8b06-3f0e62008de7` — *Security: authz in associateDocumentWithAsset*
Finding: **authz · high** at `packages/assets/src/actions/assetDocumentActions.ts:20` (`associateDocumentWithAsset`)
Fingerprint: `packages/assets/src/actions/assetDocumentActions.ts#associateDocumentWithAsset`

## Finding confirmed

`associateDocumentWithAsset` checks only the coarse `asset:update` permission and then inserts a
caller-supplied `entity_id` / `document_id` into `document_associations` without verifying record-level
access to either side. A user narrowed away from a client can therefore attach a document they control to
that client's asset. `removeDocumentFromAsset` has the mirror gap: it checks only `asset:delete`, loads an
arbitrary `association_id`, never requires `entity_type = 'asset'`, and deletes without authorizing the
associated asset or the document.

The same file already demonstrates the expected mechanism in `getAssetDocuments`: it resolves the asset,
builds a read context with `createAssetReadContext(trx, tenant, user)` and gates on
`isAssetReadAllowed(trx, tenant, context, asset)`. The write paths simply never adopted it.

## Proposed change (single file: `packages/assets/src/actions/assetDocumentActions.ts`)

Both mutations stay inside their existing `withTransaction(knex, …)` block so the authorization read and
the write observe the same snapshot and the delete/insert cannot race the check.

### `associateDocumentWithAsset`

1. Keep the coarse `hasPermission(user, 'asset', 'update')` gate.
2. Inside the transaction, resolve the target asset tenant-scoped:
   `assets.where({ asset_id: input.entity_id }).first('asset_id', 'client_id')`.
3. Build `const context = await createAssetReadContext(trx, tenant, user as any)` and require
   `await isAssetReadAllowed(trx, tenant, context, asset)`; if the asset is missing or not readable,
   return `permissionError('Permission denied: Cannot associate documents with assets', …)` and insert
   nothing.
4. Authorize the document from the caller's perspective: load the document row tenant-scoped and run
   `authorizeAndRedactDocuments(trx, tenant, user, [document])` (the same helper the read path uses). If the
   returned set is empty, deny with the same `permissionError` and insert nothing. This prevents attaching
   a document the caller cannot itself access.
5. Insert the association exactly as today (`entity_type: 'asset'`, `created_by: user.user_id`).

### `removeDocumentFromAsset`

1. Keep the coarse `hasPermission(user, 'asset', 'delete')` gate.
2. Inside the transaction, load the association tenant-scoped and require
   `association.entity_type === 'asset'`; otherwise deny and delete nothing.
3. Resolve the asset by `association.entity_id`, build the read context, and require
   `isAssetReadAllowed(trx, tenant, context, asset)`.
4. Authorize the document (same `authorizeAndRedactDocuments` on `association.document_id`); deny if not
   returned.
5. Only then delete the association and `revalidatePath`.

Do not accept any unchecked entity, document, or association identifier past authorization. Reuse the
existing helpers rather than introducing new ones; `assetActionErrors` continues to normalize DB errors.

## Regression coverage

Add/extend `packages/assets/src/actions/__tests__/assetDocumentActions.authorization.test.ts`, mirroring
the mock shape already used in `assetInventoryActions.authorization.test.ts`
(`createAssetReadContext` / `isAssetReadAllowed` mocked):

- associate: unreadable asset → `permissionError`, `document_associations.insert` not called.
- associate: readable asset but unauthorized document → `permissionError`, insert not called.
- associate: readable asset + authorized document → insert called once with `entity_type: 'asset'`.
- remove: association with `entity_type !== 'asset'` → delete not called.
- remove: asset unreadable or document unauthorized → delete not called.
- remove: readable/authorized → delete called once.

Each negative test must fail against current `main` (no record-level check) and pass after the change.

## Acceptance

The `security-finding-resolved` check confirms this finding is fixed with the regression tests above, or
refuted with evidence. No other finding is in scope for this card.
