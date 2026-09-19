# Co-managed client integration notes

## Decisions

- Use `docs/plans/` for this follow-on to the [original implementation plan](../2026-09-06-co-managed-it-plan.md).
- Make the MSP client record the persistent home for setup and relationship management. Keep purchased capacity sponsor-wide and make the global Co-managed IT screen a cross-client overview.
- Preserve customer-owned workspaces, administrator acceptance, customer-controlled sharing, separate billing authority, and the UI-only `release-v1-6-feature` boundary.
- This plan specifies future implementation. Checklist completion and acceptance evidence begin unclaimed.

## Initial source findings

- `server/src/components/co-managed/CoManagedClientAction.tsx` redirects to `/msp/co-managed?clientId=…`; it does not render persistent relationship state.
- `CoManagedOverview.tsx` owns billing state, pool purchase, provisioning, and queue/archive links in one screen.
- `CoManagedProvisioningPanel.tsx` owns both the paginated sponsor list and setup/allocation dialogs. Its `initialClientId` preselects creation rather than selecting a persistent client relationship.
- `packages/clients/src/context/ClientCrossFeatureContext.tsx` provides optional cross-feature render callbacks. Client-owned components must receive feature UI through composition rather than import app or enterprise code.
- `ee/server/src/lib/actions/coManagedBillingActions.ts` requires `account_management:update`; relationship-management permission alone cannot purchase capacity.

## Evidence

- Reviewed the original plan and T01–T22 source audits. Historical implementation evidence does not establish acceptance of the proposed client tab, purchase continuation, or re-keyed targets.
- Planning checks and additional discoveries are recorded below as the plan is completed.

## Target and composition discoveries

- `resolveTarget` is private to `server/src/lib/actions/coManagedPolicyActions.ts`. Its six consumers cover policy read/search, customer scope save, sponsor assignment save, and SLA read/save. Delegation has its own `target` helper; departure has `resolveDepartureTarget` in the domain package. All sponsor paths currently discover through home-owned provisioning operations.
- `managementPolicy.ts` projects persisted operation client/board identities through home policy. Re-keying must retain this check rather than trusting the client route or a foreign relationship ID.
- `20260906010000_create_co_management_foundation.cjs` enforces one live sponsor per customer tenant and one live allocation per sponsor/customer. It does not enforce one customer workspace per MSP client. The plan requires explicit multiple-relationship selection and a sponsor-serialized duplicate-Enable guard rather than silently taking the first row or deleting existing mappings.
- Full-page `ClientDetails` uses `ClientCommandCenter` and `FocusViewHost`. Drawers use `CustomTabs`; quick view uses only Details. `FocusViewHost` puts unknown tabs under More, so the plan explicitly adds co-managed to Service.
- `CustomTabs.hideTrigger` preserves URL-addressable content. It is unsuitable for original T21.
- The existing command-center unsaved guard covers only Details/Additional Info. Client co-managed drafts need explicit dismissal handling.

## Purchase discoveries

- `getCoManagedBillingState` currently reports `canPurchase` from self-host status and account permission. It does not establish usable Stripe configuration or an enterprise checkout implementation.
- `CoManagedOverview` renders provisioning only after its billing state loads. The proposed client and overview composition separate these loads.
- The purchase API accepts an absolute pool quantity. Shortfall must become `currentPoolCapacity + shortfall`, not the client allocation or additional-seat count.
- `runCoManagedPurchase` retains `preparing`, `checkout`, `completed`, and `expired` states. Reservation admission blocks growth during preparing/checkout even if the displayed pool has space. A successful purchase response does not by itself grant an increase before verified reconciliation.
- `/msp/licenses` redirects hosted users. Hosted pool management belongs in the existing enterprise Account Management composition; implementation must follow its registered navigation rather than inventing a self-host link.
- The CE checkout fallback returns null and the CE purchase actions throw. Plan a typed unavailable state, not a button that reaches those fallbacks.

## Work and evidence decisions

- `ticketQueue.ts` already combines native/shared queries, but `workspaceTenant` cannot filter native MSP tickets and sponsored customer work by a single MSP client. The plan adds a sponsor-client predicate before paging/count/export for the client Tickets view.
- Original T21 covers UI-only gating. M6 updates evidence for summary/tab/rail, portal dialogs, account pool editing, legacy navigation, and client work integration. Original T22 remains backend flag independence.
- The plan contains six milestones, 33 implementation items, and 21 representative verification items. All begin `implemented: false`.
- Full browser/provider checks are planned evidence, not executed during documentation authoring. Existing audit results remain historical.

## Plan validation, 2026-09-11

- `python3 /home/robert/.agents/skills/alga-plan/scripts/validate_plan.py docs/plans/2026-09-11-co-managed-client-integration` passed for all four artifacts, 33 features, and 21 tests.
- A temporary planning checker verified unique IDs, complete feature-to-test coverage, milestone values, PRD heading references, seven distinct documentation links, and 24 repository source paths. All checklist items remain false.
- `git diff --no-index --check /dev/null <file>` passed for each new plan artifact. Using no-index includes these untracked files in the whitespace check.

## M1 implementation, 2026-09-11

Implemented the client target and read contracts.

### Domain

- `packages/co-managed/src/managementPolicy.ts` now exports `CoManagedManagementSelector` with explicit `customer-home` and `sponsor-client` branches, `resolveCoManagedManagementTarget`, `getCoManagedClientManagement`, and `getCoManagedOperationTarget`. The sponsor branch authorizes the local client through the existing `setupChoices`/`operations` record-policy projection, discovers every authorized mapping for that client, resolves the exact customer relationship by `sponsor_tenant` + `sponsor_client_id`, and returns `absent`, `selection-required`, or `resolved` without leaking hidden candidate counts.
- Seat usage in the client read view uses `countCoManagedCommittedSeats` and is only returned when the actor holds per-relationship management authority.
- `prepareCoManagedProvisioningForActor` now resumes the current operation when any live mapping already exists for the authorized local client, using the sponsor-serialized entitlement lock as the duplicate-setup admission. Acknowledged cleanup and ended relationships still permit a deliberate new setup.
- `getCoManagedOperationTarget` maps a legacy operation ID to its canonical local client and relationship and returns null for a missing, foreign, or conflicting `expectedClientId`.
- `packages/co-managed/src/departure.ts` accepts a pre-qualified customer/sponsor target so the departure adapter uses the same selection as policy and settings.

### Adapters

- `coManagedPolicyActions.ts` re-keys all six consumers (policy read/search, customer scope save, sponsor assignment save, SLA read/save) onto the shared resolver and routes every one through `coManagedBrowserActor`. Legacy `operationId` inputs remain as narrow compatibility selectors; inputs also accept an explicit `selector`.
- `coManagedActions.ts` exposes `getCoManagedClientManagement`, `resolveCoManagedManagementTargetAction`, and `resolveCoManagedLegacyOperation`.
- `coManagedDelegatedAdministrationActions.ts` and `coManagedDepartureActions.ts` accept the same selector while preserving operation-ID compatibility.

### Evidence

- `ee/temporal-workflows/src/__tests__/integration/helpers/coManagedManagementPolicyCases.ts` adds five cases: authorized sponsor-client resolution plus admission-consistent usage; foreign/forged/mismatched denial and redaction; explicit selection for multiple current relationships with retained ended history; single-setup resume under different operation IDs; and legacy operation-to-client mapping with conflicting-client rejection.
- Direct run against the migrated database: `DB_HOST=127.0.0.1 DB_PORT=5472 DB_USER_ADMIN=postgres DB_NAME_SERVER=server npx vitest run src/test/integration/coManagedBootstrap.integration.test.ts -t "co-managed client target and read contracts"` passed 5/5; the existing `-t "co-managed management policy"` block passed 7/7.
- `server/src/test/unit/product` (83 files, 627 tests) passed, including the updated policy, delegation, departure, management, provisioning, and overview suites.
- `npx tsc -p packages/co-managed/tsconfig.json --noEmit` is clean. The server project typecheck reports only the three pre-existing `src/lib/notifications/sendEventEmail.ts` errors.

### Remaining M1 gaps

- F007 is partial: the resolver and action exist and are tested, but the route/presentation adapters that consume them are part of M2/M5.
- T002 does not yet add a dedicated revoked-session/API-override case (covered today by the existing management-policy suite). T005 does not yet exercise SLA read/save plus every command identity in one regression. Citus evidence for the new client mapping lookup has not been recorded; the branch's Citus container is running but no new index or transaction path was added, so the lookup path matches the existing `operations` projection.

## M2 implementation, 2026-09-11

Implemented the client composition seam, summary, stable co-managed view, and async registration behavior.

### Composition seam

- `ClientCrossFeatureContext.tsx` adds optional `renderClientCoManagedIntegration` with `ClientCoManagedIntegrationProps` and `ClientCoManagedSlots`. The contract is a render child that receives `null` (ordinary client) or a summary plus a stable `co-managed` tab.
- `MspClientCrossFeatureProvider` accepts `clientCoManagedIntegration` and includes it in the context value; it does not import any server or enterprise implementation.
- `WorkspaceProviders` injects the app-owned `ClientCoManagedIntegration`. AlgaDesk returns before the provider mounts, so it stays out of MSP sponsorship composition.
- `ClientDetails` invokes the optional callback unconditionally and otherwise renders its body with no feature slots, so the ordinary client always mounts. A `co-managed` tab joins the registry only when slots are supplied; quick view still renders Details only.
- `FocusViewHost` places `co-managed` in the Service rail group.

### App-owned integration

- `CoManagedClientIntegration.tsx` evaluates `release-v1-6-feature`, loads `getCoManagedClientManagement` once per client/relationship while usable, and supplies the summary and tab. Unavailable, loading, denied, and failed states render the ordinary client with no reads or controls. A generation counter discards stale responses after a client/relationship switch or unmount.
- `CoManagedClientSummary.tsx` shows relationship state and used/allocated seats with an Enable or Manage link to the canonical `?tab=co-managed` view.
- `CoManagedClientView.tsx` shows relationship state, seats, workspace, and administrator invitation status; when a relationship exists it embeds the existing policy and SLA sections, namespaced by `idPrefix`.
- `CoManagedClientAction` now opens the canonical client co-managed view instead of the global provisioning page.

### Async registration

- `ClientCommandCenter` now opens a tab whose `?tab=` value changes after mount (summary action), and closes a focus view whose tab leaves the registry without reopening it when the tab returns. The existing async-registration and consume-once behavior is preserved.

### Evidence

- `server/src/test/unit/product/coManagedClientIntegration.test.tsx` covers disabled/loading/unknown/error flags with no read or slots, the supplied summary and `co-managed` tab, denied/failed reads falling back to the ordinary client, stale-response discard on relationship change, and late responses after unmount.
- `packages/clients` command-center tests add the co-managed async registration/rail case and the tab-removal close case; all 18 pass. `packages/clients` typechecks clean.
- `coManagedClientAction.test.tsx` asserts the canonical client route. Server `src/test/unit/product` and `src/test/unit/layout` (738 tests) pass.

### Remaining M2 gaps

- F011's quick-view link is not yet supplied: the tickets quick view uses the lean `MspClientQuickViewProvider`, which has no integration injected. T007 therefore stays unmarked.
- F013 is not started: draft lifecycle across section changes, the unsaved-dismissal guard for feature drafts, and a formal section router are M3 work.
- The co-managed tab embeds the legacy operation-ID policy/SLA panels rather than a client selector; that switch belongs with M3's extracted sections.

## M3 and partial M4 implementation, 2026-09-11

### M3 client relationship management

- `CoManagedClientSetup.tsx` fixes the local client, prefills the workspace name from the client record, keeps the original operation ID across an uncertain submission, and marks the tab dirty on edit.
- `CoManagedClientRecovery.tsx` resumes the original operation for retry/resend/cancel and distinguishes an expired invitation from a delivery failure.
- `CoManagedClientSeats.tsx` changes allocation with the current expected-seat identity and floors it at the committed count.
- `CoManagedClientView.tsx` composes status/setup, capacity, access (policy), SLA, delegated administration, and history/departure sections, namespaced by `idPrefix`. Ended relationships render retained history and no live settings, and the read adapter stops reporting live seat usage once a relationship has ended.
- The quick-view link (F011) is wired: `ClientQuickView` renders the compact summary through the seam and `MspClientQuickViewProvider` passes the outer integration through.
- `TabContent` gained optional `hasUnsavedChanges`/`onDiscardUnsavedChanges`; `ClientCommandCenter` guards feature drafts on close and invokes the discard callback (F013).

### M4 purchasing (partial)

- `getCoManagedBillingState` now returns a typed, sanitized `purchase` availability object: deployment, sponsorship eligibility, account authority, implementation availability, provider readiness, pending operation, `canPurchase`, `canResume`, and a reason. A CE/absent implementation or unconfigured provider can never present as available, and no keys or provider references are returned.
- `CoManagedOverview` renders provisioning independently of billing readiness, so a billing failure cannot blank setup progress, recovery, or history.
- `CoManagedClientSeats` computes `additionalAllocation` and `shortfall`, and converts a shortfall into an absolute pool target of `current pool + shortfall` before preview and checkout. The submitted purchase operation and quantity are frozen across checkout and ambiguous responses; a browser completion callback only prompts verified-capacity refresh.

### Evidence

- New/updated tests: `coManagedClientManagement.test.tsx` (7), `coManagedLegacyRedirect.test.tsx` (5), `coManagedClientIntegration.test.tsx` (8), command-center feature-draft guard, `coManagedManagementActions.test.ts` typed-availability cases, and the quick-view contract assertion. `server/src/test/unit/product` is 649 passing; `packages/clients` command-center and quick-view suites pass; `packages/ui`, `packages/clients`, and `packages/co-managed` typecheck clean; server project typecheck matches the pre-existing baseline.

### Remaining M4 gaps

- F022 (stale-preview invalidation when the pool baseline changes) is only partially handled; F023 still needs explicit reconciliation and allocation-race recovery coverage.
- F024 (session-scoped client drafts and validated relative return navigation), F025 (hosted account pool editor and self-host License Management routing), and F026 (full degradation matrix) are not implemented. T011-T014 remain open.

## M4 completion and M5 start, 2026-09-11

### Purchasing completion (F022, F023, F025, F026)

- `CoManagedClientSeats` now invalidates a quote when the pool baseline changes before confirmation and only permits a new purchase operation after an acknowledged terminal expiry. It distinguishes checkout, verified entitlement, and allocation completion: after a successful update it waits for `capacity >= target` and then retries the prepared allocation, while a competing allocation keeps the purchased seats in the shared pool with a retryable error.
- `coManagedClientDraft.ts` stores a session-scoped, expiry-bounded seat draft keyed by client and relationship, carrying no payment secret, invitation token, or authority.
- `useCoManagedPurchaseController.ts` is the shared hosted purchase controller. `CoManagedPoolEditor` renders it in Account Management (full pool increase, reduction, pending recovery, explicit confirmation) and routes self-host capacity changes to License Management. `CoManagedOverview` now composes that editor instead of its own pool UI.
- The degradation matrix is exercised for no permission, ineligible sponsor, unavailable implementation, unconfigured provider, pending operation, self-host license, and an embedded checkout session without a usable publishable key.
- F024 remains open: the session draft is done, but explicit validated return navigation through account/license management is not.

### M5 start (F028, F029)

- The combined queue accepts a `clientId` selector that matches native MSP tickets by `tickets.client_id` and shared work by the relationship's `sponsor_client_id`, applied before search, counts, and pagination. `CoManagedTicketQueue` locks that selector, and the client composition replaces the Tickets tab with the scoped combined queue when a relationship exists.
- The global overview no longer opens a global create dialog; operation rows navigate to the canonical client section through the legacy adapter, and the ticket/project queue and archive entry points remain.

### Evidence

- New tests: `coManagedPoolEditor.test.tsx` (hosted review, checkout-unavailable retention, self-host routing); extended `coManagedClientManagement.test.tsx` for stale baseline, verified-capacity continuation, and the degradation messages; a migrated-DB queue case asserting the sponsor-client filter includes native plus shared work and excludes a sibling client. `server/src/test/unit/product` is 659 passing; the affected `packages/clients` suites pass; `packages/co-managed`, `packages/clients`, and `packages/ui` typecheck clean; server and EE typechecks match their existing baselines.

### Remaining M5/M6 gaps

- F027 (searchable/paginated cross-client overview table) and F030 (client-context project/task entry points) are not implemented; T015 remains open. T012-T014 need real database/provider journeys, and M6 still needs the full T21 boundary inventory, hosted/self-host browser evidence, and the documentation updates.

## M5 completion, M6 boundary and documentation, 2026-09-11

### M5 completion (F024, F027, F030)

- The overview now renders `CoManagedClientOverviewTable`, an authorized, searchable, paginated client table sourced from `getCoManagedClientOverview`. Search, sort, and count run inside the same record-policy projection before pagination, so pool totals are never reconciled from a restricted client list. Relationship rows and the provisioning list render only when the viewer can read relationships; the pool editor stays independent.
- The client view adds a Work section linking to native MSP projects and the qualified shared task queue, keeping ordinary work in the MSP shell.
- F024 is complete: the session seat draft is keyed by client and relationship with an expiry, and self-host shortfalls link to License Management with a validated relative `returnTo` destination that the licenses page only echoes when it is a same-app relative path.

### M6 boundary and documentation (F031, F033)

- `coManagedT21Boundary.contract.test.ts` pins the boundary inventory: the client integration, Account Management pool editor, and every legacy adapter page are wrapped, the adapter performs no discovery while unavailable, the ordinary client renders with no slots, and the backend resolver/actions contain no release-flag check.
- Documentation updated: `docs/features/feature-flags.md` now describes the client composition, Tickets override, pool editor, legacy adapters, and their flag semantics. The original plan and the T01-T07, T08-T15, and T16-T22 audit files received dated addenda that separate the new client-integrated coverage from the historical global-page evidence and record the still-pending provider/browser/Citus items.

### Evidence and remaining gaps

- New tests: `coManagedClientOverviewTable.test.tsx`, `coManagedT21Boundary.contract.test.ts`, the migrated-DB overview case, the self-host return-destination case, and the client Work links. `server/src/test/unit/product` is 666 passing; `packages/co-managed`, `packages/clients`, and `packages/ui` typecheck clean; server typecheck matches baseline; `scripts/validate-translations.cjs` passes.
- F032 is not complete: new copy renders through English `defaultValue` fallbacks (consistent with the repo's feature-copy pattern) and uses existing theme tokens with wrapping layouts, but no locale entries or browser theme/narrow verification were added. T005 and T012-T013 (real database and provider recovery journeys), T018-T019 (hosted/self-host browser and issuer journeys), and T021 (CE/EE build plus translated/narrow/dark presentation) remain pending or blocked on external provider/browser availability.

## F032 localization and remaining evidence, 2026-09-11

### F032 implementation

- Added the new client, overview, shortfall, and purchase copy as real translations in all seven non-English locales (`de`, `es`, `fr`, `it`, `nl`, `pl`, `pt`) plus `en`, then regenerated the `xx`/`yy` pseudo-locales. `node scripts/validate-translations.cjs` passes and `node tools/i18n/audit-all.cjs` reports 0 untranslated, 0 forbidden, and 0 structural errors across all seven audited locales (one Spanish term was corrected from `presupuesto` to `cotización` to satisfy the glossary).
- The new surfaces already use existing themed UI components and `rgb(var(--color-*))` tokens, with `flex-wrap`/`max-w` layouts, so light/dark and narrow presentation follow the design system. CE/EE compatibility holds: server and EE typechecks match their baselines, and `packages/co-managed`, `packages/clients`, and `packages/ui` all build successfully.

### Test closure

- T005 and T012 are covered by the resolver re-key cases plus the existing migrated-DB purchase persistence suite (`coManagedReservations.integration.test.ts`), which exercises concurrent dedupe, lost-response recovery, pending-operation blocking, reduction refusal, and cross-sponsor isolation.
- T013 adds component coverage for an ambiguous timeout (the frozen operation is reused on retry), an acknowledged checkout expiry (a new operation is permitted only then), an embedded checkout session without a usable key, and verified-entitlement allocation completion.

### Blocked evidence

- T018 (hosted browser journey with real Stripe test-mode checkout and reconciliation) and T019 (self-host browser journey with a live issuer) are blocked: the environment has no `STRIPE_SECRET_KEY`, `STRIPE_CO_MANAGED_USER_PRICE_ID`, or external issuer configured. The plan's required-evidence rules say to record these as blocked with their dependency rather than pass them through fixtures.
- T021's build/typecheck portion is satisfied (baseline typechecks plus successful package builds); its browser presentation portion (translated locale, narrow viewport, light/dark, keyboard/focus return) is blocked on a running server for this revision and is not claimed as executed.

## Browser evidence and a composition fix, 2026-09-11

### Executed browser journey (T021 partial)

Against the running dev server for this revision (`http://localhost:3374`, `release-v1-6-feature` forced on) and the migrated `server_co_managed` database:

- `/msp/clients/<id>?tab=co-managed` opens the stable `co-managed` focus view in the Service rail with the compact summary and the relationship selector. Captured `t021-client-co-managed-light.png` and `t021-client-co-managed-dark.png` (dark applied through the `dark` theme class; body background `rgb(12,10,24)`).
- `/msp/co-managed` renders the sponsor pool editor, the cross-client overview table, and the ticket/task/archive entries. Typing `Emerald` in the overview search narrowed the table to Emerald City, and `zzzzz` produced the empty state. Captured `t021-overview-light.png`.
- `/msp/co-managed?clientId=<id>` redirected to `/msp/clients/<id>?tab=co-managed` (the legacy adapter), and `/msp/co-management?operationId=<invalid>` rendered the generic unavailable state without exposing a client identity.

Artifacts are in `docs/evidence/co-managed-client-integration/`.

### Composition fix found by the journey

The browser journey exposed a real state bug: a client whose only relationship had ended showed the client-fixed setup form instead of explicit history selection. `CoManagedClientView` now renders setup only when the client has no relationships, shows the relationship selector whenever selection is required, labels an ended-only state as retained history, and the header summary distinguishes multiple current relationships from an ended history. A focused component test covers the ended-only case; `server/src/test/unit/product` is 669 passing.

### Still unexecuted

The drawer-tab composition, a narrow viewport, and a translated locale were not captured: the browser pane has no viewport/locale emulation command and the client drawer could not be opened from the list reliably. T018/T019 remain blocked on absent provider configuration. These stay recorded as pending/blocked rather than passed.

## Stripe emulator purchase journey, 2026-09-11

The hosted purchase blocker is lifted by using the repository's Stripe emulator instead of a real Stripe test account.

### Emulator support

- `packages/emulators/stripe` now models the subscription surface the co-managed purchase needs: `GET /v1/prices/:id`, `GET/POST /v1/subscriptions/:id`, `DELETE /v1/subscriptions/:id`, `GET /v1/subscriptions`, `POST /v1/invoices/create_preview`, `GET /v1/checkout/sessions` (list), and subscription-mode `POST /v1/checkout/sessions`. Completing a subscription-mode Checkout creates the subscription with the session metadata and emits the signed `checkout.session.completed` webhook. New `price` and `subscription` seeders and `prices`/`subscriptions` state views support deterministic setup. Existing payment-mode behavior is unchanged; the emulator's own suite (27 tests) still passes.
- `ee/server/src/lib/stripe/StripeService.ts` now honors `STRIPE_API_BASE_URL` exactly as `StripePaymentProvider` and the Temporal worker client do, so the EE billing service can target the emulator without changing production behavior when the variable is absent.

### Executed evidence

`server/src/test/integration/coManagedPurchaseEmulator.integration.test.ts` runs the real `StripeService` against an in-process `stripeEmulator`:

- `previewCoManagedSeats(tenant, 3)` reads the seeded `$11.49` monthly price and returns a `$34.47` total and due-now.
- `purchaseCoManagedSeats` creates a subscription-mode Checkout session; completing it creates the subscription and delivers the webhook, but capacity stays `0` until verification.
- Recovering the same operation ID returns `{ kind: 'updated' }` and reconciles verified capacity to `3`/`3`; a repeated call is idempotent (one co-managed subscription, one completed operation).

The extended emulator also passes the existing 25-case invoice-payment-links journey and the full `server/src/test/unit/product` suite (669 tests). EE and server typechecks match their baselines.

### Remaining

T018's full browser journey (shortfall review to checkout to reconciliation through the UI, plus customer-admin acceptance) still requires a dev server restarted with the emulator environment (`STRIPE_API_BASE_URL`, `STRIPE_CO_MANAGED_USER_PRICE_ID`, `STRIPE_PRO_PRICE_ID`) and a standalone emulator; the service-level journey is executed and the browser steps are now unblocked rather than impossible.

## Browser smoke test through the Alga Dev IDE, 2026-09-11

A full smoke test ran on the live revision through the Alga Dev IDE browser pane against the migrated `server_co_managed` database. Screenshots and a written record are in `docs/evidence/co-managed-client-integration/` (`smoke-*.png`, `SMOKE-TEST.md`).

Covered end to end: the client `co-managed` Service view and summary, ended-history selection, the client-fixed setup form, setup submit into a reserved/provisioning operation, recovery retry, refresh survival, the global overview pool totals and authorized client table with search, the overview-to-client Manage navigation, the client Tickets combined queue, the hosted Account Management pool editor, and every legacy adapter (`clientId`, `operationId`, SLA, administration, departure) mapping to the canonical client section.

The smoke test found and fixed five defects:

1. `coManaged.overview.client/workspace/status/seats/actions` were missing from every locale, so the overview table headers fell back to key text. Added and translated in all eight locales plus pseudo-locales.
2. `CoManagedClientIntegration` dropped its slots on a manual refresh, which unmounted the `co-managed` tab and closed an open focus view after setup. It now retains the current slots on refresh and only resets on a client/relationship change or a first-load failure.
3. `CoManagedClientView` rendered the access/SLA/delegation sections during provisioning, showing load errors before a relationship is active. Those sections now render only for an active relationship.
4. Viewing a relationship's history appeared to refresh the whole screen: selecting a relationship called `router.push`, so the server route re-rendered and the focus view closed. The integration now owns the selected relationship and loads it in place, syncing the URL only shallowly, and the header summary action opens the tab through a new in-place `openTabRequest`/`onOpenTab` seam rather than a route navigation.
5. The “View history” button blanked and reloaded the whole page. It linked to the legacy `/msp/co-management/departure?operationId=…` route, whose adapter redirects a sponsor operation back to the same client section — a circular navigation. The ended-history action now links to the retained shared-work archive, and a live relationship embeds the departure experience in the client view instead of the legacy adapter.

Post-fix verification: `server/src/test/unit/product` 669 passing; `packages/clients` typechecks and command-center tests (including the new in-place tab request) passing; emulator purchase journey and migrated-database resolver/overview cases passing; `tools/i18n/audit-all.cjs` clean; server typecheck at baseline. The Temporal worker did not advance the new operation past `queued`, so the run stops at progress/recovery rather than customer acceptance.









