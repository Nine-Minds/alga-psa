# Design — record-level authorization for asset-group reads and mutations

Card: `6def2f3e-7510-5e51-a979-9efdec924529` — *Security: authz in getAssetGroup*
Finding: **authz · high** at `packages/assets/src/actions/assetGroupActions.ts:158`
Fingerprint: `.../assetGroupActions.ts#getAssetGroup`

## Finding confirmed

`listAssetGroups` accepts an arbitrary `clientId` and `getAssetGroup` an arbitrary `groupId` after only
coarse `asset:read` (lines 146-168); the detail includes member asset IDs/names/tags/statuses and contact
names/emails (`packages/assets/src/lib/assetGroups.ts:562-607`). Group creation/update/deletion, membership
changes, ownership changes and user changes check only coarse `asset:update` and never evaluate the group's
client or member assets against the caller's record scope (lines 182-367). Client IDs are obtainable via
the unguarded lookup action, so a selected-client-narrowed user can read or mutate excluded-client groups.

## Proposed change (service seam in `packages/assets/src/lib`, thin actions)

1. Introduce an **authorized asset-group service** (new module in `packages/assets/src/lib`, or extend
   `assetGroups.ts`) whose functions take `(trx, tenant, user, …)` and:
   - resolve the group → its `client_id` and all member assets (`asset_id, client_id`);
   - build `createAssetReadContext(trx, tenant, user)` and require `isAssetReadAllowed` for the group's
     client and **every** affected member asset (deny if any is out of scope);
   - then perform the read/mutation.
2. Route the actions through it:
   - `listAssetGroups(clientId)` — authorize the client before listing.
   - `getAssetGroup(groupId)` — authorize the group client + members before returning details.
   - `createAssetGroup(input)` — authorize `input.clientId` and each supplied `assetIds[]`.
   - update/delete/membership/ownership/user changes — load the group, authorize its client and all
     affected member assets (both removed and added) inside the same transaction, then write.
3. Keep the coarse `asset:read`/`asset:update` gates as the outer bound; return `permissionError` with the
   existing message keys (`readAssets` / `updateAssets`) on denial. Preserve `withGroupErrors` behavior.

## Regression coverage

Add/extend `packages/assets/src/actions/__tests__/assetGroupActions.authorization.test.ts`
(mock `createAssetReadContext` / `isAssetReadAllowed` and the lib service):

- `getAssetGroup` with an out-of-scope client/member → permission error, details not returned.
- `listAssetGroups` for an out-of-scope client → permission error, `listGroupsForClient` not called.
- create with an out-of-scope client or any out-of-scope supplied asset → no group created.
- update/member-add/member-remove/owner/user change touching an out-of-scope asset → mutation not applied.
- fully in-scope operation → unchanged behavior.

Negative tests must fail on current `main` and pass after.

## Acceptance

`security-finding-resolved` confirms the finding is fixed with the tests above, or refuted with evidence.
