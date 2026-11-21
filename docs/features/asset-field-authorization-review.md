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

## Edit-flow walkthrough — verified

The edit flow passed on 2026-11-21 in the development app at port 3818, using the restricted QA account and runtime revision `b84b85eada4dc861c9a471d9496b69d05628f038`. This follow-up adds tests and documentation without changing the application code. The [review guide](http://100.109.101.64:24818/) retains the six-path read demonstrations and adds a [32-second edit recording](http://100.109.101.64:24818/edit-20261121/edit-walkthrough.webm).

1. Open the workstation's **Actions → Edit**, or its `/msp/assets/a4056000-0000-4000-8000-000000000001/edit` route. Purchase cost and serial inputs are blank because those values are concealed.
2. Change only the name to `Authz 4056 Smoke Workstation - edited` and select **Save Changes**.
3. Confirm the detail page shows the changed name. Reopen the edit page and confirm the name persisted while purchase cost is still blank.
4. Compare privileged database snapshots. Stored purchase cost remains `987654`; serial number, RMM ID, private attributes, and workstation LAN/WAN IP addresses are unchanged. The actual form request omits purchase cost; the mutation response and follow-up read omit every concealed path.
5. Restore the original name through the same form. The observed second save also preserved concealed values. The fixture remains masked for repeat review.

Evidence: [persistence and masking assertions](http://100.109.101.64:24818/edit-20261121/assertions.json), [decoded request and responses](http://100.109.101.64:24818/edit-20261121/save-decoded.json), and privileged database snapshots [before](http://100.109.101.64:24818/edit-20261121/db-before.json), [after](http://100.109.101.64:24818/edit-20261121/db-after.json), and [after restoring the name](http://100.109.101.64:24818/edit-20261121/db-restored.json). These contain synthetic fixture values. Other nullable procurement fields are covered by automated action and rendered-form regressions.

## Automated checks executed for the repair

Focused behavioral suites passed: 82 tests in seven files, exit code 0. They cover the existing six read paths and record denial, masked loads, unrelated updates with explicit null/blank/invalid/replacement submissions, nested masked descendants in attributes and extension JSON columns, ancestor replacements, implicit nested-array masks, whole-element array masks with stable indices, history/workflow output redaction, readable nullable-field clearing, and form submission with a concealed required attribute.

The three added cases exercise the rendered form with purchase cost alone concealed, the form with all procurement fields concealed, and the authenticated action receiving an older form's explicit null defaults. Removing the client payload guard makes both new form cases fail with an unexpected `purchase_cost: null`. Removing the server mask makes the new action case fail because the stored cost, currency, manufacturer, model and order number become null. Both guards were restored before the passing suite and live saves. Logs: [focused suite](http://100.109.101.64:24818/officer-focused-tests.txt), [without the client guard](http://100.109.101.64:24818/officer-form-without-guard.txt), [without the server mask](http://100.109.101.64:24818/officer-action-without-guard.txt).

Array coverage includes empty objects whose only fields were concealed, null positions before masked elements, and permitted sibling edits through multiple array levels. Historical deltas labelled by `field`, `field_name`, or `path` conceal both indexed values and ancestor values containing hidden descendants. Values at different explicit indices remain readable when their paths are permitted.

The action test's in-memory row store verifies values after the update transaction; the live walkthrough independently verifies PostgreSQL persistence. The preceding implementation assignment passed the assets package build and typecheck, plus the full server typecheck with `NODE_OPTIONS=--max-old-space-size=16384`. This test-and-documentation follow-up reran the focused suite. Earlier server typecheck attempts with 4 GB and 8 GB exhausted Node's heap.

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
