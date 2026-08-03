# Contract Simulator Tab Feature Flag - Implementation Plan

**Card:** Contract simulator feature flag
**Branch:** `feature/contract-simulator-flag`
**Scope decision:** Gate only the Contract Simulator tab/entry surface. Routes, server actions, APIs, tier enforcement, and other simulator entry points are deliberately unchanged.

## Current code

- `packages/billing/src/components/billing-dashboard/contracts/ContractDetail.tsx` is a client component and renders both the `TabsTrigger value="simulator"` and matching `TabsContent` unconditionally.
- The simulator remains dynamically loaded from `@product/billing/entry`; the workspace already performs its own tier check with `TIER_FEATURES.CONTRACT_SIMULATOR`.
- Product UI feature flags use `useFeatureFlag` from `@alga-psa/ui/hooks`. Existing callers pass a stable key and an explicit default when the flag should fail closed.
- The current checkout has an unrelated modified `package-lock.json`; implementation must leave it untouched.

## Design

Use a PostHog feature flag named `contract-simulator`, defaulting to disabled while unresolved.

In `ContractDetail.tsx`:

1. Import `useFeatureFlag` from `@alga-psa/ui/hooks`.
2. Evaluate `useFeatureFlag('contract-simulator', { defaultValue: false })` in `ContractDetail` and retain the boolean `enabled` result.
3. Render the Simulator `TabsTrigger` only when the flag is enabled.
4. Render the matching Simulator `TabsContent` only when the flag is enabled, so a hidden entry surface also does not mount or load the simulator.
5. If the URL requests `contractView=simulator` while the flag is disabled, normalize the selected tab to the existing safe default (`edit`) and update/replace the query through the component's existing tab/query-state path. This prevents a hidden selected value and blank content while keeping all backend surfaces untouched. Do not redirect or block simulator routes/APIs.

Keep the dynamic import and tier guard unchanged. The feature flag controls discoverability of this one contract-detail tab; it is not an authorization boundary.

## Verification

Add or extend a behavioral React test around Contract Detail's tab rendering:

- flag disabled (including the loading/default state): the Simulate tab is absent and simulator content is not mounted;
- flag enabled: the Simulate tab is present;
- direct `contractView=simulator` with the flag disabled falls back to Overview/edit rather than leaving a hidden active tab.

Mock the feature-flag hook at its public `@alga-psa/ui/hooks` boundary. Do not add source-text or import-presence assertions.

Run the narrow Contract Detail test target, then the billing package typecheck/build command used by the package. Manually spot-check the running dev stack on port 3195 with the flag off and on if local PostHog overrides are available.

## Explicit non-goals and risks

- No route, API, server-action, or billing-engine gating.
- No changes to simulator tier/edition behavior, wizard/template entry points, or flag administration.
- Do not remove or rename `contractView=simulator`; enabled users retain existing deep links.
- Fail closed while flag state loads to avoid a tab flashing briefly before disappearing. Query normalization must avoid a render/update loop and must preserve unrelated query parameters.
