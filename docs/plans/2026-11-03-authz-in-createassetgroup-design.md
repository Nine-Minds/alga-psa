# Design — Security: authz in createAssetGroup

Card: Security: authz in createAssetGroup

## Finding (confirmed on main)

createAssetGroup (packages/assets/src/actions/assetGroupActions.ts:182-205) and addAssetsToGroup (:265-279) check only coarse `asset:update` and accept caller-controlled assetIds, then assetGroups.ts:231-295 inserts membership and may rewrite assignee/location; group updates propagate to members (:417-491), so a Restricted Asset Operator can mutate out-of-team assets.

## Approach

1. Batch-load every affected asset inside the group transaction and authorize `asset:update` per record (including the same_team rule) before creating membership or propagating group changes.
2. Fail closed listing the offending asset ids rather than partially applying; do the same on group update/delete.
3. Tests: a Restricted Asset Operator cannot add or mutate out-of-team assets via a group; in-team assets still work; a partial-authorization request is refused whole.

## Hand-off
This file is the spec the Link Spec step links to this card's PSA ticket; record it in state.psaSpecPaths.
