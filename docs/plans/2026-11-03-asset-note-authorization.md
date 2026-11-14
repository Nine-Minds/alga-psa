# Asset note authorization

## Objective

Protect asset note reads and mutations from authenticated users who lack the
corresponding asset permission or record-level authorization for that verb.

## Design

- Export `assertAssetAccess(trx, tenant, user, assetId, action)` from
  `packages/assets/src/lib/assetReadAuthorization.ts`.
- Require the matching coarse permission (`asset:read`, `asset:update`, or
  `asset:delete`) and the kernel's record-level decision for the requested action.
  Bundle rules narrow the RBAC grant when present; built-in client scope also
  applies without bundle rules. Fail closed if bundle resolution fails.
  Evaluate the decision against the asset's `asset_id` and `client_id`; missing
  assets and denied access return the same `Asset not found` error shape.
- Run authorization and all note document, association, and block-content
  operations through the same transaction.
- Protect `getAssetNoteContent`, `saveAssetNote`, and `deleteAssetNote`. REST
  routes continue to call these actions, so they share the same authorization.

## Behavioral verification

- Cover read, update, and delete permission/policy outcomes, including authorized
  users without bundle rules and rules that only narrow a different action.
- Verify denied note reads do not access note data and denied saves/deletes leave
  document, association, block-content, and asset-link state unchanged.
- Run focused asset authorization and note-action tests, then the assets package
  build and typecheck.
