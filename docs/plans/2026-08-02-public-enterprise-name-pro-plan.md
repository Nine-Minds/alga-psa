# Public product naming: Enterprise to Pro

## Decision summary

Customer-facing product and upgrade copy should call the paid product **Pro**. The repository's implementation edition remains **Enterprise** internally. This is a terminology change, not an entitlement, packaging, edition-selection, billing, or data-model change.

The implementation should use targeted replacements at existing user-visible boundaries. It should not introduce a new global `PUBLIC_EDITION_NAME` abstraction or mechanically replace every occurrence of `Enterprise`. The tier model already has a central display source: `packages/types/src/constants/tenantTiers.ts` exports `TIER_LABELS`, and `packages/ui/src/components/tier-gating/FeatureUpgradeNotice.tsx` already renders the required tier from that map. Edition-gated stubs and localized edition copy do not share that path, so they should be updated in place while preserving their existing seams.

## Repository evidence

- Branch: `feature/public-enterprise-name-pro`.
- Planning base: `3e0a46fde2`, the current `origin/main` merge commit at inspection time.
- The recent history includes edition-aware navigation and CE upgrade-prompt work, plus the adjacent `docs/plans/2026-08-02-edition-alias-cleanup-plan.md`. Those changes reinforce the distinction between edition wiring and public upgrade language.
- The worktree already has unrelated modifications in `package-lock.json` and `packages/core/src/workSchedule.ts`. The implementation must not include or rewrite them.
- Build/runtime edition values are split across `EDITION=ee`, `NEXT_PUBLIC_EDITION=enterprise`, `isEnterprise`, `@enterprise`, `MenuEdition = 'enterprise'`, and package/file names under `ee/`. These are active compatibility seams, not display labels.
- Paid tenant tiers are `essentials`, `solo`, `pro`, and `premium`. `TIER_LABELS.pro` is already `Pro`, and tier-gated notices already use that label.

## Terminology inventory

### Terms that should be public

Use `Pro` when the text is naming the paid product or telling a customer which product unlocks a feature.

Examples in the current tree include:

- `Enterprise Feature`, `Enterprise feature`, and `Enterprise Edition` headings and notices in CE/OSS fallback components.
- Upgrade, licensing, trial, and hosted-deployment copy in `server/public/locales/*/msp/licensing.json`.
- Extension page, extension-settings, chat, billing, policy, workflow, email, RMM, SSO, integration, and contract-simulator fallback copy.
- Public documentation that describes the paid product rather than the build architecture.
- A direct UI rendering of an edition-gated action error, if the application presents that exact error to a person.

Preferred forms are `Pro feature`, `requires Pro`, `available in Pro`, `AlgaPSA Pro`, and `Pro trial`. Do not invent `Pro Edition` where the existing sentence can simply say `Pro`.

### Terms that already have the right tier meaning

Keep these meanings and use the existing tier source:

- `Solo`, `Pro`, and `Premium` tenant plans.
- `TIER_LABELS`, `FEATURE_MINIMUM_TIER`, `TIER_FEATURE_MAP`, and `TIER_FEATURES`.
- `FeatureUpgradeNotice`, `TierGate`, `ServerTierGate`, and `assertTierAccess` behavior.
- Existing license-banner copy such as `Pro trial`, `Pro features`, and `Upgrade to Pro`.

No tier value, tier rank, feature minimum, trial transition, Stripe mapping, or account-plan behavior changes.

### Terms that must remain internal or compatibility-sensitive

Keep the following unchanged unless a specific occurrence is rendered as customer-facing copy and is handled at that boundary:

- `enterprise` and `ee` environment values, `NEXT_PUBLIC_EDITION`, `EDITION`, `isEnterprise`, `isEnterpriseEdition`, and related predicates.
- `@enterprise`, `@ee`, `@product/*`, `MenuEdition`, `ProductEdition`, and package/file/directory names.
- `ADD_ONS.ENTERPRISE`, `assertAddOnAccess`, Enterprise Stripe product/price identifiers, license metadata, database values, and serialized API enum values.
- Translation key names such as `enterpriseFeature`, `enterpriseOnly`, `enterpriseHeading`, `requiresEnterprise`, and `eeDisabled`. Change their values when needed; do not rename keys in this card.
- Technical comments, architecture guides, build/configuration guides, runbooks, generated OpenAPI/MCP registries, and test names when they describe the implementation edition rather than the public product.
- Generic English usage such as “enterprise application,” “enterprise integrations,” “enterprise-grade,” customer/company names, and named add-ons such as the Enterprise AI Assistant when Enterprise is not the paid product label.

## Plausible implementation boundaries

### A. Global rename

Replace every `Enterprise` occurrence with `Pro` across source, tests, docs, translations, generated artifacts, API responses, and identifiers.

This is rejected. It would rename the edition-selection contract, break compatibility-sensitive error strings and generated descriptions, corrupt legitimate generic usage, and conflate the Enterprise build with the Pro tenant tier.

### B. New central public-edition name source

Add a shared constant or helper such as `PUBLIC_EDITION_NAME = 'Pro'`, route all edition-gated components through it, and add a new translation strategy around it.

This is also rejected for this card. Most copy is already localized or embedded in existing product entry points, while edition-gated CE fallbacks are intentionally separate from tier-gated notices. A new helper would add a second naming system without removing the existing translation keys or handling grammatical context. It could be reconsidered later as part of a broader copy architecture effort.

### C. Targeted public-copy replacements (selected)

Update only rendered product naming, its existing localized values, the small set of public documentation statements, and tests that assert those surfaces. Preserve all technical seams and wire contracts unless a UI demonstrably exposes a response verbatim.

This is the smallest coherent boundary. It aligns the paid product name with the existing Pro tier, avoids a code-wide semantic rename, and leaves CE/EE resolution and feature gating untouched.

## Implementation plan

### 1. Establish the copy rule at the source boundary

Before editing, classify each `Enterprise` match as one of:

1. Product/edition label shown to a customer: change to `Pro`.
2. Tier or plan label: use `TIER_LABELS`/existing tier copy; do not duplicate a new constant.
3. Named add-on or generic adjective: retain it unless product strategy explicitly says otherwise.
4. Technical edition identifier or compatibility contract: retain it.
5. API/action error: inspect consumers. Change only if the application renders the exact message to users; otherwise retain the wire text and map it to localized Pro copy at the UI edge if needed.

Use this classification instead of a case-insensitive repository-wide replacement.

### 2. Update direct user-visible fallback and stub components

Update the rendered strings and metadata in the existing public/OSS surfaces, keeping exports, aliases, component names, route behavior, and CE/EE replacement seams intact. The initial source inventory includes:

- `packages/product-billing/oss/entry.tsx`
- `packages/product-chat/oss/entry.tsx`
- `packages/product-auth-ee/oss/entry.tsx`
- `packages/product-extensions/oss/entry.tsx`
- `packages/product-settings-extensions/oss/entry.tsx`
- `packages/product-extensions/pages/list.tsx`
- `packages/product-extensions/pages/details.tsx`
- `packages/product-extensions/pages/settings.tsx`
- `packages/product-extensions-pages/oss/list.tsx`
- `packages/product-extensions-pages/oss/details.tsx`
- `packages/product-extensions-pages/oss/settings.tsx`
- `packages/ui/src/components/settings/extensions/InstallerPanel.tsx`
- `packages/ui/src/components/settings/policy/PolicyManagement.tsx`
- CE-facing placeholders under `packages/ee/src/components/`, including workflow, email, policy, SSO, RMM, and integration settings components.
- Any `ee/server/src` page/component that is actually rendered as a public placeholder, such as the workflow-run, extension, or billing-simulator fallback. Do not edit comments solely because they contain Enterprise.

Examples of intended outcomes:

- `Enterprise Feature` becomes `Pro Feature` in a product-gated placeholder.
- `The workflow system is only available in the Enterprise Edition` becomes `The workflow system is only available in Pro`.
- `Extensions (Enterprise)` and `Learn about Enterprise` become `Extensions (Pro)` and `Learn about Pro` when they are rendered in the customer UI.
- A sentence such as `Advanced authorization bundle management is available in Enterprise Premium` should be corrected to the actual public tier wording, likely `Premium`, rather than blindly becoming `Pro Premium`. Confirm the required tier from `FEATURE_MINIMUM_TIER` before editing.

Do not replace `Enterprise` in a component comment, import seam, test description, or code identifier just because the neighboring UI copy changes.

### 3. Update existing localization values without renaming keys

Keep the current namespace and key structure. Update English values and the corresponding translated values for the public product references in every maintained locale: `de`, `en`, `es`, `fr`, `it`, `nl`, `pl`, and `pt`. Preserve the pseudo-locale key/value strategy for `xx` and `yy`; their placeholder values are not translation copy.

The initial English inventory includes these namespaces and keys:

- `msp/licensing.json`: `reduceModal.enterpriseOnly`, `purchaseForm.enterpriseOnlyHosted`, `workflowDesigner.enterpriseHeading`, and `workflowDesigner.unavailable`.
- `msp/extensions.json`: `enterpriseFeature.*`, `settings.enterpriseOnly.*`, `page.description`, `detail.metadataTitle`, `detailsPage.description`, and `settingsPage.description`.
- `msp/core.json`: `rightSidebar.enterpriseOnly`.
- `msp/email-providers.json`: `enterpriseOnly` where it means the paid product. Retain `aiUpsell`'s `Enterprise AI Assistant add-on` if that is a distinct named add-on.
- `msp/settings.json`: `enterpriseOnly.*`, `rmmEnterpriseNote`, and feature descriptions that use Enterprise as the edition gate. Retain the explicit Enterprise AI Assistant add-on wording and generic “enterprise application” wording.
- `msp/contracts.json`: contract-simulator title/description where Enterprise is the edition label.
- `msp/schedule.json`: `eeDisabled` value where it is shown to a user.
- `msp/dashboard.json`: managed-email `enterpriseOnly` value.
- `msp/user-activities.json`: workflow-task `enterpriseOnly` value.
- `features/inventory.json`: `requiresEnterprise` value if it describes the Pro requirement rather than an add-on.
- `msp/integrations.json`: public badge values such as `integrations.accounting.setup.badges.enterprise`; retain the key name and update only the displayed label if it is the product badge.

The exact final list must come from a fresh English-locale search and call-site review. Do not change every string containing “enterprise”; for example, `enterprise` selector keys and `enterpriseSteps` keys remain stable, while their displayed values change only when they name the paid product.

For translated sentences, keep `Pro` as the product/tier name and translate the surrounding grammar normally. Do not add new locale keys solely for this rename. Run the repository translation validator after edits to confirm identical key structures and preserved interpolation variables.

### 4. Update public documentation selectively

Update customer-facing product and installation prose where it labels the paid product:

- `README.md` edition/licensing paragraphs and the appliance trial description.
- `docs/getting-started/appliance_install.md` trial and upgrade wording.
- Public feature setup documents such as `docs/inbound-email/setup/microsoft.md` and `docs/stripe-integration-setup.md` when their statement is a customer-facing availability claim.
- Any other non-generated guide found by the same terminology inventory that says a feature requires the Enterprise product.

Retain `Enterprise Edition` in technical documentation that explains the build, source ownership, or deployment contract, including `docs/getting-started/enterprise_edition_architecture.md`, CE/EE setup/configuration guides, `docs/tier-gating-guide.md` implementation terminology, and architecture/runbook material. If a technical guide contains both concepts, rewrite the customer-facing sentence to Pro but retain the code/configuration example as Enterprise.

Do not edit generated SDK/OpenAPI/MCP artifacts in isolation. If a source API description is deliberately classified as public product copy, update the source and regenerate the artifact in the same implementation change; otherwise leave both unchanged for compatibility and scope control.

### 5. Preserve CE and paid-edition behavior

The change must not alter feature availability:

- Community Edition continues to use the same CE fallbacks, edition-aware navigation, and `isEnterprise` checks. A CE user may see `Pro` in an upgrade message, but the build remains Community Edition.
- Hosted/paid Enterprise builds continue to resolve the same EE implementations through the same aliases and environment values. Their public upgrade/license copy uses Pro where the text names the product.
- `Essentials` remains the self-hosted appliance floor. `Solo`, `Pro`, and `Premium` retain their existing trial and billing transitions.
- CE's tier bypass remains unchanged. Do not use `FeatureUpgradeNotice` to replace edition stubs unless the current component is genuinely tier-gated; CE edition availability and paid tenant tier access are different decisions.
- No changes are made to navigation filtering, route guards, server-action authorization, Stripe product mapping, license enforcement, database values, or migrations.

### 6. Handle API and action messages conservatively

Audit direct consumers of strings in CE stubs and action/route modules, including calendar, Teams, Entra, QuickBooks, Xero, Hudu, chat, appliance, extension, and MCP boundaries.

- If an existing page displays the response text verbatim, make the user-visible result say Pro. Prefer a UI translation/mapping boundary when the underlying error is also an external wire contract.
- If the text is only a machine-facing response, log, internal exception, generated API description, or compatibility assertion, leave it as Enterprise Edition and document the reason in the implementation PR.
- Update exact-string tests only for intentionally changed public output. Do not weaken tests to make a global rename pass.

This keeps public copy accurate without silently changing integrations that may compare error messages.

## Test plan

### Focused component and contract coverage

Update or add assertions for the public surfaces represented by the existing tests:

- `server/src/test/unit/workflowsCeStubEntry.unit.test.tsx`: CE workflow placeholder says Pro while still rendering the same fallback.
- `server/src/test/unit/ceAccountStub.unit.test.tsx`: account/billing placeholder uses the public product name selected by the copy rule.
- `server/src/test/unit/components/integrations/EntraIntegrationPage.dynamicImport.test.tsx`: placeholder heading/body uses Pro.
- `server/src/test/unit/app/pageTitles.metadata.test.ts`: extension metadata uses Pro only where the metadata is customer-visible.
- `ee/server/src/__tests__/deploy/workflows-ee-deploy-no-stub.playwright.test.ts`: EE build does not accidentally render the CE Pro placeholder.
- Existing extension, chat, billing, policy, email, integration, and license-render tests: assert the new public copy and unchanged component behavior.

Add a small focused test only where no current test covers a changed public boundary. Avoid a repository-wide assertion that no `Enterprise` string remains; legitimate internal and generic uses must continue to exist.

### Localization coverage

- Run `node scripts/validate-translations.cjs`.
- Run existing i18n contract tests such as `server/src/test/unit/i18n/mspDashboardBatch2b1.test.ts`, `server/src/test/unit/i18n/mspCoreBatch2b1.test.ts`, and `server/src/test/unit/layout/RightSidebar.i18n.test.tsx`, updating expected public values only.
- Verify that all changed keys retain their interpolation variables and that `xx`/`yy` remain structurally valid.

### Boundary and regression coverage

- Run the targeted Vitest files for changed components and message boundaries.
- Run the relevant CE/EE edition-resolution tests to prove aliases, edition predicates, and navigation behavior are unchanged.
- Run `npm run build:ce` and `npm run build:ee` if the implementation changes product entry points or edition-resolved components. If a full build is unavailable, record the exact limitation and run the narrowest equivalent package tests.
- Perform a final `rg` audit over user-visible source, locale values, and docs. The audit should show no unclassified product-label uses of `Enterprise`, while the allowlist of internal identifiers, technical docs, add-on names, generic adjectives, and compatibility strings remains intentionally present.

## Exclusions

This card does not include:

- Renaming `Enterprise Edition` to `Pro` in environment variables, aliases, package names, directory names, TypeScript types, route paths, database/schema values, Stripe identifiers, license payloads, or feature flags.
- Changing `Community Edition`, `Essentials`, `Solo`, or `Premium` semantics.
- Changing tier entitlements, CE bypass behavior, edition-aware navigation, route/action guards, billing, licensing, migrations, or deployment topology.
- Renaming translation keys or restructuring the i18n system.
- Replacing edition-gated stubs with tier-gated components.
- Renaming the distinct Enterprise AI Assistant or Enterprise add-on plumbing without a separate product decision.
- A repository-wide rewrite of technical docs, generated API registries, historical plans, test names, comments, or logs.
- Introducing a general-purpose public naming framework.

## Verification checklist

Before handoff, verify that:

1. The English product UI says Pro in every classified edition/product label.
2. Maintained translations preserve keys, variables, and locale structure, with Pro used consistently as the tier/product name.
3. CE still renders the same fallback routes and messages functionally, and paid builds still resolve the same EE implementations.
4. Existing Pro/Premium tier displays and trial flows are unchanged.
5. Technical `enterprise`/`ee` identifiers and compatibility-sensitive messages remain unless a reviewed UI boundary required a public-copy change.
6. Public docs use Pro for the product but retain Enterprise in build/architecture instructions where it is the actual implementation term.
7. Focused tests, translation validation, and the appropriate CE/EE build or smoke checks pass.
8. `git diff --check` passes and the final diff contains only the intended product-copy, locale, doc, and test changes. No unrelated worktree changes are staged.

## Expected implementation file groups

The implementation should be limited to the following groups after call-site verification:

- Existing public/OSS and CE placeholder components listed above.
- Existing locale JSON values under `server/public/locales/`.
- Selected public product/install documentation.
- Tests that assert the changed rendered copy, metadata, translations, or deliberately changed UI-facing errors.

No new migration, API, shared edition helper, product-code change, or generated artifact is expected.
