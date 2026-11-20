# Design — record-level authorization for RMM user mapping

Card: `198fd389-25e9-5d09-a0a7-601ce35f23ce` — *Security: authz in mapRmmUserToContact*
Finding: **authz · high** at `packages/assets/src/actions/rmmUserAssignmentActions.ts:37`
Fingerprint: `.../rmmUserAssignmentActions.ts#mapRmmUserToContact`

## Finding confirmed

`suggestAssigneeFromRmmUser` checks only coarse `asset:read` before resolving an arbitrary asset's raw
signed-in OS username, matching contact, integration ID and provider
(`shared/rmm/signedInUserMappings.ts:88-174`). `mapRmmUserToContact` checks only coarse `asset:update` and
trusts caller-supplied `integrationId`, `provider`, `rawUser`, `contactId` and `assignAssetId`
(lines 37-56). The core (`signedInUserMappings.ts:204-317`) writes the external mapping and can assign the
specified asset **plus every matching auto-mode device in the organization** with no caller-specific
record authorization. A selected-client-narrowed updater can therefore alter mappings and assignments for
excluded assets.

## Proposed change (two files; keep the core generic)

Thread an authorization callback into the shared core instead of importing assets code there:

1. Define in `shared/rmm/signedInUserMappings.ts` an `authorize` callback option on the mapping and
   suggestion functions, e.g.
   `authorize(input: { assetIds: string[]; contactId: string | null; integrationId: string }): Promise<void>`
   which throws (or returns a denial) when any asset/contact/integration is out of scope. The core calls it
   **inside its existing transaction** before any write, and again filters auto-mode candidates through it
   before assigning.
2. In `packages/assets/src/actions/rmmUserAssignmentActions.ts`, build that callback from the existing asset
   authorization helpers: resolve each asset, build `createAssetReadContext(trx, tenant, user)` and require
   `isAssetReadAllowed(trx, tenant, ctx, asset)`; authorize the contact (contact record scope) and the
   integration against the caller. Pass it to both `suggestContactForAsset` and `mapSignedInUserToContact`.
3. Filter every auto-mode candidate asset through the same check before changing assignments — never
   authorize only the single named `assignAssetId`.
4. Keep the coarse `asset:read`/`asset:update` gates as the outer bound; the new callback is the
   record-level layer. Preserve the existing error mapping (`assetActionErrorFrom` /
   `permissionError`) so the dialog still surfaces the rollback.

Do not let the shared package depend on assets-package internals; the callback keeps the seam one-way.

## Regression coverage

Add `packages/assets/src/actions/__tests__/rmmUserAssignmentActions.authorization.test.ts`
(mock `createAssetReadContext`/`isAssetReadAllowed` and the shared core):

- `assignAssetId` outside scope → mapping not written; `permissionError`.
- auto-mode candidate list containing an out-of-scope asset → that asset not assigned (in-scope ones are).
- suggestion for an out-of-scope asset → permission error, raw username not returned.
- fully in-scope mapping → writes as today.

Negative tests must fail on current `main` (coarse-only gate) and pass after.

## Acceptance

`security-finding-resolved` confirms the finding is fixed with the tests above, or refuted with evidence.
