# Design — Security: authz in assignAssetContact

## Finding (confirmed on main)

packages/assets/src/actions/assetAssignmentActions.ts:123-164 checks only coarse asset:update before setAssetAssignee; getAssetAssignments (:51-78) checks only asset:read for an arbitrary asset.

## Approach

1. Shared transactional asset guard enforcing the record-level decision before assignment read/write.
2. Called from assignAssetContact and getAssetAssignments.
3. Tests: narrowed internal and client users cannot assign or read assignments out of scope.

## Hand-off
This file is the spec the Link Spec step links to this card's PSA ticket; record it in state.psaSpecPaths.
