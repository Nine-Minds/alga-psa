# Asset field authorization review

PR #4130 keeps asset field redactions in the existing authorization decision and applies them to each read surface and to updates.

## Read-path review

Prior live demonstrations were captured on 2026-11-21 at revision `2d209ee2297b1732d06d66772bdacf0cf37f9bc8`. They remain evidence for the demonstrated read behavior. They covered masked, unrestricted, denied, and restored access for:

- `getAsset`
- `getAssetDetailBundle`
- `listAssets`
- `listEntityAssets`
- `getAssetHistory`
- `getAssetMaintenanceReport`

They also exercised asset detail, filtered asset list, and a ticket asset drawer. The external review page at `/home/robert/.alga-xo/reviews/feature-security-authz-in-getasset/index.html` retains the prior payloads, screenshots, recording, and fixture/reset instructions.

## Edit-flow walkthrough — pending live verification

The automated checks cover the mutation boundary. A reviewer should still perform this live walkthrough after deploying the repair revision to the review environment:

1. Sign in as the restricted QA user and load the masked workstation. Confirm the restricted serial, purchase cost, and private fields are absent.
2. Edit only the asset name and save.
3. Reload as the restricted user. Confirm the new name appears while restricted fields remain absent.
4. Use privileged database or account access to confirm the name changed and stored purchase cost, masked nullable base values, extension values, and private structured attributes remain unchanged.
5. Capture the environment and exact revision, plus screenshots or response evidence. Confirm the mutation response and follow-up masked read still omit concealed values.

No browser verification of this edit flow was performed during the repair assignment. Do not treat this walkthrough as an observed result.

## Automated checks executed for the repair

Focused behavioral suites passed: 67 tests in seven files. They cover the existing six read paths and record denial, masked loads, unrelated updates with explicit null/blank/invalid/replacement submissions, nested masked descendants in attributes and extension JSON columns, ancestor replacements, stable and reshaped arrays, history/workflow output redaction, readable nullable-field clearing, and form submission with a concealed required attribute. The action test's in-memory row store verifies values after the update transaction; live privileged database verification remains part of the pending walkthrough. The assets package build and typecheck passed. A full server typecheck in the prior repair round exhausted Node's heap at both 4 GB and 8 GB.

Commands:

```sh
cd server
npx vitest run \
  ../packages/assets/src/actions/assetActions.updateNumericFields.test.ts \
  ../packages/assets/src/lib/projectAssetReadFields.test.ts \
  ../packages/assets/src/lib/assetFormPayload.test.ts \
  ../packages/assets/src/actions/assetActions.customTypes.test.ts \
  ../packages/assets/src/components/AssetForm.customTypes.test.tsx \
  ../packages/assets/src/components/AssetForm.procurement.test.tsx \
  ../packages/assets/src/components/AssetForm.drawerActions.test.tsx
```
