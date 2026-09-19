# Client-integrated co-managed IT

Status: planned. Date: 2026-09-11.

## Outcome

MSP operators enable and manage co-managed IT from the corresponding client record. That record shows relationship status, customer-technician capacity, setup recovery, and the MSP's relationship settings. The global Co-managed IT page provides cross-client oversight. Purchased capacity remains a sponsor-wide pool, with full subscription management in account/licensing settings and contextual purchase when a client needs more seats.

This follows the [original implementation plan](../2026-09-06-co-managed-it-plan.md#primary-experience). It refines the MSP experience; the customer retains its own workspace, user administration, acceptance decision, and sharing authority.

## Problem and users

The existing client header action navigates to `/msp/co-managed?clientId=…`. That page combines purchase, provisioning, allocation, progress, and work links. Relationship settings then use a provisioning operation ID as their navigation identity. Operators must leave the client record to answer basic questions about that client's service.

Primary users:

- Relationship managers: configure a client, allocate existing capacity, recover setup, and assign MSP staff within customer-approved scope.
- Account administrators: purchase or reduce the sponsor's pool and recover billing problems. Some also manage relationships; these permissions remain independent.
- Read-only operators: inspect permitted relationship status and navigate to authorized work.
- Customer administrators: accept the relationship and manage their own technicians, scope, and delegation through the existing customer experience.

## Scope

### Goals

1. Make a durable `co-managed` client view and a compact client status summary discoverable in both the full-page and drawer compositions.
2. Resolve MSP relationship-management targets from the authorized local client and an explicit relationship selection where required.
3. Reuse provisioning, allocation, policy, delegation, departure, and purchase engines behind client-oriented adapters.
4. Let authorized users buy a seat shortfall during setup or allocation, with explicit price review and recoverable continuation.
5. Make the global page useful for comparing clients and finding exceptions, with links to the client record.
6. Extend original T21 UI-boundary coverage and retain T22 backend flag independence.

### Boundaries

- Keep the existing monthly pool model, regular MSP seat separation, customer administrator acceptance, and 30-day lapse behavior.
- Keep customer-approved sharing and delegated administration distinct from MSP staff assignment. Sponsorship does not grant customer-administrator authority.
- Reuse the existing immutable operation receipts, qualified work identities, authorization, and archive behavior.
- Customer seat allocation does not create a resale contract or invoice line automatically. MSP-to-customer billing remains in existing commercial workflows.
- Connecting existing customer tenants, cross-installation trust, additional sponsors, annual co-managed pricing, and automatic hosting migration remain outside this work.
- This work integrates entry points and client-scoped work discovery. It does not replace the entire ticket/project application or introduce a new analytics engine.

## Current implementation anchors

Paths below are relative to the repository root.

| Area | Current source and implication |
| --- | --- |
| Client entry | `server/src/app/msp/clients/[id]/page.tsx` injects `CoManagedClientAction` through `headerActions`. Drawer clients do not receive this route-specific injection. |
| Client composition | `packages/clients/src/components/clients/ClientDetails.tsx` builds `tabContent`. Full pages use `ClientCommandCenter`; drawers use `CustomTabs`; quick view renders Details only. |
| Focus navigation | `packages/clients/src/components/clients/command-center/FocusViewHost.tsx` groups registered views. Unknown IDs fall under More. `ClientCommandCenter.tsx` waits for asynchronously registered deep links. |
| Package seam | `packages/clients/src/context/ClientCrossFeatureContext.tsx`, `packages/msp-composition/src/clients/MspClientCrossFeatureProvider.tsx`, and `server/src/components/layout/WorkspaceProviders.tsx` provide the composition path for app-owned feature UI. |
| Management | `server/src/lib/actions/coManagedActions.ts` delegates to `packages/co-managed/src/managementPolicy.ts`. Status currently lists provisioning operations and does not return a complete per-client usage summary. |
| Target selection | `resolveTarget` in `server/src/lib/actions/coManagedPolicyActions.ts` accepts an MSP provisioning operation ID. Delegation and departure have separate operation-based resolvers. |
| Combined screen | `server/src/components/co-managed/CoManagedOverview.tsx` loads billing before rendering provisioning. `CoManagedProvisioningPanel.tsx` owns both the global list and client setup/allocation dialogs. |
| Purchase | `ee/server/src/lib/actions/coManagedBillingActions.ts` accepts an absolute pool quantity and requires `account_management:update`. `packages/licensing/src/lib/co-managed-purchases.ts` retains preparing/checkout/completed/expired operations. |
| Edition fallback | `packages/ee/src/lib/actions/coManagedBillingActions.ts` throws and `packages/ee/src/components/co-managed/CoManagedCheckout.tsx` renders null. Neither is a working purchase fallback. |
| Billing homes | Hosted account UI is `ee/server/src/components/settings/account/AccountManagement.tsx`. `/msp/licenses` is self-host-only and redirects hosted users. |
| Work | `packages/co-managed/src/ticketQueue.ts` combines native/shared work before pagination. Its current `workspaceTenant` filter is not a sponsor-client filter. |
| Release boundary | `server/src/components/co-managed/CoManagedFeatureBoundary.tsx` requires `enabled === true`, no loading, and no error. Original requirements and evidence are in [T21/T22](../co-managed-audit-t16-t22.md#t21--ui-release-boundary) and [feature-flags.md](../../features/feature-flags.md). |

## Client experience

### Entry and composition

Canonical entry: `/msp/clients/[clientId]?tab=co-managed`. A selected relationship may add `relationshipId`; use `section` only for a validated internal subsection such as licenses, access, SLA, or history. These query values select a view; they confer no authority.

Register one stable `co-managed` entry in `ClientDetails`' existing registry. Put it in the Service group of `FocusViewHost`, not the automatic More group. The full-page command center opens that focus view in place. The full drawer exposes the same content through its existing tabs. Quick view retains Details-only behavior and offers a compact summary/link to the full client's co-managed view.

Use an additive, optional composition seam in `ClientCrossFeatureContext`, supplied by `MspClientCrossFeatureProvider` and injected from `WorkspaceProviders`. A proposed contract is a `renderClientCoManagedIntegration` callback receiving `clientId`, `clientName`, an instance-specific `idPrefix`, and a render child. It supplies either no feature slots or a descriptor containing the summary and tab content. The default invokes the child with no feature slots.

The app-owned integration component handles product eligibility, the release boundary, and client-authorized discovery. It loads a lightweight summary once per mounted client scope, then supplies both the summary and tab descriptor. Detailed settings and checkout mount only when opened. The callback returns a React component; feature hooks live inside that component, not in conditional callback execution in `ClientDetails`.

Implementation requirements:

- The ordinary client body always renders. Extend the shared boundary with a presentation fallback, or extract its client-side eligibility predicate, so disabled feature composition yields the normal client with no feature slots. Do not place the whole PSA client screen behind a null-rendering boundary.
- `packages/clients` and `packages/msp-composition` do not import `server/src` or `@enterprise` implementations. The application injects the implementation through the existing dependency direction. No new general-purpose plugin system is needed.
- Register the tab only after the flag is usable and client read authority is resolved. Distinguish loading, denied, unsupported, and load failure. A retryable summary error must not appear as “not enabled.”
- Keep the `co_managed` customer product and AlgaDesk out of MSP sponsorship composition. Product eligibility uses the actual product, not merely `!isAlgaDeskMode`.
- Preserve asynchronous deep-link handling. If the tab becomes unavailable, close it, unmount its dialogs, and fall back to the normal client view without a redirect loop or a later unsolicited reopen.
- Share refresh state between summary and tab. Key state by authenticated sponsor, client, selected relationship, and component instance; ignore stale responses after switching client/relationship or unmounting.
- Setup/allocation drafts survive local section changes. Extend the existing focus/tab dismissal behavior to handle unsaved feature drafts; the current record-only dirty guard does not cover them. Never move drafts or uncertain commands from one client to another.
- Namespace all input/dialog/automation IDs by instance so a full page and drawer can coexist. Preserve keyboard navigation, focus return, existing theme tokens, and translations.

### Summary and state

The compact summary shows the relationship state and, when authorized, used/reserved versus allocated technician seats. Its action opens setup for an unconfigured client or management for an existing relationship. Do not repeat an Enable action once setup is in progress.

| State | Client view |
| --- | --- |
| No relationship | Explain the customer workspace and show Enable co-managed IT when setup is permitted. Prefill the saved client name; keep this client fixed. |
| Queued/provisioning | Show progress, reserved seats, and the existing operation. Refresh/retry that operation. |
| Failed or cleanup requested | Show retryable failure or pending cleanup. Release capacity only after acknowledged cleanup. |
| Awaiting acceptance | Show initial administrator/invitation state, resend/recovery where permitted, and that customer acceptance is still required. |
| Active | Show allocation/usage, approved scope, MSP assignments, SLA mappings, and permitted delegated actions. |
| Grace/deficit/read-only | Show the durable deadline and recovery path. Prevent growth as the domain requires; preserve permitted reads, reductions, and recovery. |
| Ended | Show retained relationship history and archive links under MSP authority. Do not refresh current customer-private data or imply that live access remains. |

Use separate sections for status/setup, licenses, access/SLA, and history/departure. Extract embeddable sections from existing page components rather than nesting standalone pages with their own headings and containers.

Seats mean active customer technicians plus distinct live invitation reservations, using the existing admission calculation. Report each count and the allocation limit consistently. Requester contacts and MSP technicians do not consume customer seats. Detailed customer user information is shown only with the relevant authority; aggregate capacity reporting must not become an unrestricted foreign directory query.

MSP users configure their own staff assignments and existing SLA mappings. Customer-approved sharing is read-only on the MSP side. The agreed escalation destination can be displayed here; making it editable after activation requires its own supported domain command and is not implied by relocating settings.

## Target resolution and API changes

### Re-key `resolveTarget`

Replace operation-ID navigation as the normal MSP policy/settings interface with an explicit selector:

```ts
type CoManagedManagementSelector =
  | { kind: 'customer-home' }
  | { kind: 'sponsor-client'; clientId: string; relationshipId?: string };
```

Names are proposed. Use an explicit branch rather than interpreting a missing argument as both “customer home” and “MSP directory.” A delegated workspace directory remains a distinct read operation.

The resolver must:

1. Derive the authenticated home tenant and tracked browser actor. Apply the existing internal-user, product, session, RBAC, record-policy, and redaction rules before returning client/relationship labels or counts.
2. For customer-home, resolve only the actor's own relationship. Reject sponsor selectors and foreign identifiers on customer actions.
3. For sponsor-client, validate the local client ID and discover candidates through authorized sponsor-owned provisioning/allocation records. Reuse the actual persisted client and escalation-board policy projection in `managementPolicy.ts`; do not accept a browser-supplied customer tenant or scan all tenants.
4. Recheck the candidate's qualified customer relationship against `sponsor_tenant`, `sponsor_client_id`, and `relationship_id`. Validate operation/allocation consistency. Discovery alone is not authorization to read customer data or mutate policy.
5. Return the qualified domain target plus the persisted provisioning operation ID when an engine needs it. Preserve the existing authorization and lifecycle lock order through writes, and recheck the target under those locks.
6. Return typed absent, selected, selection-required, unavailable, or forbidden outcomes as appropriate. Keep a genuine unconfigured client distinct from denied, malformed, stale, or inconsistent data. Denial must not reveal hidden candidate counts.

### Cardinality and stale selection

The foundation enforces one live sponsor per **customer tenant**, not one customer workspace per **MSP client**. Do not resolve a client with `.first()` or silently pick the newest operation.

- With one authorized current relationship, select it by default.
- With multiple authorized current relationships, require an explicit relationship selection and show only permitted labels. A client-scoped filter can include all authorized relationships; management acts on one selected relationship.
- Keep ended relationships in explicit history selection. An ended selection must not silently switch to another current relationship.
- All writes to an existing relationship carry its selected relationship ID as an expected identity, plus the existing revision/expected-seat fields. Initial setup creates that identity through the existing reservation engine. If the client mapping or selected relationship changes between read and submit, reject/reload rather than applying the write to a newly resolved default.
- Enable on the client is a single-setup action: while a current relationship or unfinished setup already exists, resume/select it. Add a client-level duplicate-setup guard inside the existing sponsor-serialized provisioning admission so two tabs with different operation IDs cannot create another workspace accidentally. Retain existing multiple relationships; do not merge or delete them. Creation after acknowledged cleanup or an ended relationship remains a deliberate new setup.

The duplicate-setup check considers all current mappings for the authorized local client under the sponsor lock. A mapping outside the actor's visibility still blocks duplicate creation, but the rejection returns no hidden workspace identity or count.

No new cross-tenant foreign key or replacement relationship identity is needed. Start with existing records; if an index is needed for sponsor-local client lookup, add it with tenant-qualified PostgreSQL/Citus migration coverage. Preserve immutable request fingerprints and existing operation IDs.

### Consumers and operation identities

Update all six resolver consumers in `coManagedPolicyActions.ts`: policy read, option search, customer scope save, sponsor assignment save, SLA read, and SLA save. Route browser adapters through `coManagedBrowserActor`; the re-key must not retain inconsistent browser-identity handling between policy and SLA actions.

Use the same authorized client-to-relationship selection for `coManagedDelegatedAdministrationActions.ts` and the sponsor side of `packages/co-managed/src/departure.ts`/`coManagedDepartureActions.ts`. Preserve customer-home behavior, explicit delegation authority, and post-departure archive rules.

Add a per-client read adapter in `coManagedActions.ts` backed by the management domain. It returns lifecycle, authorized summary/usage, allowed actions, and the selected relationship. It must not find a client by filtering one page of `getCoManagedProvisioningStatus` in the browser. Extend the paginated global DTO with authorized client identity and links.

Re-key client-facing allocation/retry/cancel/resend adapters to client plus expected relationship/operation. Resolve the original provisioning operation server-side and keep the current engines. Keep these identities separate:

| Identity | Purpose |
| --- | --- |
| Local client ID | Persistent MSP navigation and commercial relationship. |
| Qualified customer tenant + relationship ID | Domain authorization and exact relationship being managed. |
| Provisioning operation ID | Existing reservation, worker retry, invitation recovery, and cleanup identity. |
| Purchase operation ID | One sponsor-wide absolute pool change; independent of provisioning. |
| Policy revision / expected seats / departure command ID | Existing optimistic concurrency and mutation retry contracts. |

### Legacy links

- `/msp/co-managed?clientId=…` opens the canonical client view through a presentation adapter; it no longer auto-opens a global setup dialog.
- MSP `/msp/co-management?operationId=…`, SLA, delegated-administration, and departure links resolve the authorized sponsor-local operation to its client and exact relationship before navigating to the corresponding client section.
- Resolve legacy links inside a gated client component. Keep route registration and ordinary authorization independent of the release flag. Reject conflicting selectors; never prefer a supplied client ID over a mismatching persisted operation.
- Keep customer `/msp/co-management` and existing qualified ticket/project/task/archive routes. An invalid or inaccessible operation yields a generic unavailable state, not a route containing unauthorized client identifiers.

## Purchasing and allocation

### Separate relationship state from billing readiness

Client management must remain usable when purchase configuration or payment transport is unavailable. Load relationship state independently from purchase readiness; a failed billing request cannot blank setup progress, access settings, or historical state.

Expose a typed, sanitized purchase-availability result instead of inferring usability from `plan === 'pro'` and a permission boolean. Represent installation mode, actual sponsorship eligibility, purchase implementation availability, account permissions, provider configuration readiness, and pending operation state. Do not expose keys, provider references, or checkout secrets to relationship-only readers.

Treat absent or invalid self-host claims as missing self-host capacity, not evidence that hosted checkout is available. Use the installation's licensing mode and verified entitlement resolver. A CE fallback action that throws or checkout component that returns null must never appear as an available purchase control.

### Client shortfall flow

1. Enter the desired **client allocation**, subject to active technician and invitation limits.
2. Refresh verified pool capacity, current allocation, pending purchase, and eligibility. For creation, current client allocation is zero. Compute `additionalAllocation = max(0, desiredAllocation - currentAllocation)` and `shortfall = max(0, additionalAllocation - availablePoolSeats)`.
3. If eligible capacity already covers the increase, use the normal allocation/provisioning command without a charge.
4. If more seats are needed and purchase is available, review an **absolute pool target** of `currentPoolCapacity + shortfall`. Show additional seats, new total purchased pool, server-provided recurring total, and amount due now. The current billing API accepts total quantity, not the shortfall or client allocation.
5. Confirm purchase using its own immutable operation ID and quantity. Changing the desired quantity invalidates an unsubmitted preview. Once a purchase outcome is uncertain, recover that operation before starting another or changing its quantity.
6. After checkout/provider success, refresh verified entitlement. A browser completion callback or an `updated` purchase receipt alone does not establish new capacity. Show confirming capacity until reconciliation makes it usable.
7. Return to the same client's prepared setup/allocation and let the operator complete the existing command. Revalidate capacity and relationship identity at submit. Another client may have consumed seats in the interim.

Purchase and allocation are separate transactions. A successful purchase followed by failed allocation leaves purchased seats in the shared pool and a retryable client action. State this explicitly; do not silently refund, shrink the pool, or purchase again. Closing a dialog, switching clients, or disabling the flag does not cancel an already submitted purchase.

Preserve draft fields through the local purchase UI and return from account/license management in the same tab. Use per-session, sponsor/client-qualified draft storage with an expiry for external navigation; clear it after completion or logout. Store no payment secret, invitation token, or authority in that draft. The server's purchase operation is the source of truth after a reload.

### Purchase degradation matrix

Conditions can combine. Apply product/authorization and lifecycle restrictions first, then pending-operation rules, then provider availability. Configuration failures never grant authority or capacity.

| Condition | Client allocation/setup | Purchase UI and recovery |
| --- | --- | --- |
| Hosted, eligible Pro, authorized manager/purchaser, enough verified capacity | Allocate or provision normally. | No purchase required. Offer full pool management as a secondary action. |
| Hosted, eligible Pro, both permissions, shortfall, configured provider | Preserve the client draft until capacity is verified. | Review only the shortfall's increase to the absolute pool total, then checkout/update and reconcile. |
| Relationship manager without `account_management:update` | Allocate already available capacity within management authority. | Explain the shortfall and ask an account administrator to add capacity. No preview/purchase call or checkout secret. A billing link is shown only if readable. |
| Account purchaser without relationship-management authority | Read only what client/co-management permissions allow. No allocation or provisioning. | Manage the sponsor pool in account settings. Purchase authority does not imply client access. |
| Read-only relationship user | Inspect permitted state; no mutations. | No charge controls. Distinguish insufficient seats from insufficient authority. |
| Sponsor not eligible, including Pro loss | Block setup and increases even if counters appear sufficient. Keep permitted recovery/read/reduction paths. | Show the relevant account/license recovery destination. The provider's verified eligibility, not a display tier alone, decides purchase admission. |
| Self-host with valid signed capacity | Allocate within the verified signed pool. | No embedded hosted checkout. For a shortfall, authorized users open `/msp/licenses`, update the signed license, return, and refresh. |
| Self-host with missing/invalid/expired claims or reduced capacity | Show the existing lifecycle deadline/deficit; prevent growth. | Show license recovery or contact-the-license-administrator guidance. Do not fall back to unsigned counters or hosted purchasing. |
| CE purchase fallback or unavailable enterprise purchase implementation | Keep any ordinarily authorized, licensed relationship operation usable. | Return typed unavailable status. Do not invoke throwing CE actions or render an empty checkout dialog. |
| Missing/invalid Stripe price, secret/publishable-key configuration, or unavailable provider | Existing verified capacity may still be allocated if lifecycle permits and no purchase is pending. Relationship settings still load. | Show a specific recoverable availability message and refresh/retry. Never treat failure as a zero-price/free purchase. |
| Existing `preparing` or `checkout` operation, including one started on another client | Block growth as the existing admission engine requires, even if displayed available seats seem sufficient. Preserve existing allocations. | Authorized purchasers resume/reconcile the same sponsor-wide operation and immutable total. Other users see a pending-capacity message without payment details. |
| Preview fails or pool changes before confirmation | Keep the draft; re-read state and require a fresh preview when the expected pool baseline changed. | No automatic purchase and no reuse of a stale quote for another quantity. |
| Checkout session returned without a usable publishable key, SDK load failure, or embedded checkout error | Keep the draft and pending state. | Show retryable checkout-unavailable feedback. Resume the existing operation after repair; do not open a blank modal or create a second purchase. |
| Network timeout or ambiguous purchase response | Do not assume capacity or failure. | Recover the same operation ID/quantity. Disable duplicate confirmation while recovery is unresolved. |
| Payment declined, incomplete, or checkout explicitly closed | Leave client setup incomplete and capacity ungranted. | Offer the provider-supported retry/resume path. Closing UI alone is not a terminal server state. |
| Checkout confirmed expired | Re-read pending state; leave existing capacity unchanged. | Only after terminal expiry is acknowledged may the user review a new purchase with a new operation ID. |
| Payment succeeded, entitlement reconciliation pending | Keep growth unavailable until the verified resolver allows it. | Show confirming capacity and refresh/recovery. Do not label a second payment as the fix. |
| Purchase succeeded, client allocation loses a race or setup fails | Show seats purchased into the shared pool and the separate failed client action. | Refresh/retry allocation or setup. Any further purchase requires a new explicit shortfall review. |
| Flag becomes off/loading/unknown/error during purchase | Unmount feature controls and stop UI refresh work. | Submitted purchase/reconciliation continues normally in the backend; recover the same operation when UI is re-enabled. |

### Full pool management

Extract the pool editor from `CoManagedOverview` for reuse in hosted Account Management and contextual purchase. The account version supports total-pool increases, permitted reductions/cancellation, pending recovery, and explicit financial confirmation. The client version defaults to a shortfall increase and does not expose unrelated global reductions.

Self-host pool changes continue through License Management. Do not link hosted users to `/msp/licenses`. Preserve a validated relative return destination to the client when navigating away. The co-managed portion of account/license UI remains inside T21; ordinary account/license functionality remains available with the feature flag off.

## Global overview and work integration

Retain `/msp/co-managed` as an overview. Its primary content is an authorized, searchable/paginated client/workspace table with relationship state, allocated and consumed seats, pending invitation/setup issues, and action links to the canonical client sections. Show sponsor pool totals with labels that distinguish purchased, allocated, and available capacity from the subset of clients visible to the viewer. Do not derive restricted-client counts by subtracting visible rows from sponsor totals.

Separate pool-read authority from relationship-read authority. Account-only readers can see the pool without relationship rows; relationship readers receive only the capacity information permitted by the existing domain and the new DTO contract. Do not block the whole page on either independent load. Filter/sort/count before pagination through authorized queries.

Replace global create/edit dialogs with client navigation and a client-selection entry if setup is initiated from the overview. Retain links to working/oversight queues, tasks, and archives. Report only metrics supported by authorized sources; SLA/effort detail can initially link to existing views rather than introducing unverified aggregate KPIs.

Add a sponsor-client filter to the existing combined ticket query for use from the client's Tickets view. Match native MSP tickets by their local client ID and shared work by the relationship's `sponsor_client_id`. Apply this before counts, pagination, search, and CSV export. A workspace filter alone would omit the client's native MSP tickets. Preserve qualified row identities and existing working-versus-oversight semantics.

Expose client-context links to authorized shared project/task views. Ordinary work stays in the MSP shell. When co-managed UI is unavailable, the client's existing native ticket/project experience remains usable without feature queries or controls.

## T21 boundary and evidence updates

The exact flag remains `release-v1-6-feature`, evaluated only on the client. All boundary states other than enabled/resolved/error-free remove usable co-managed UI. Product/permission/license restrictions remain separate backend concerns.

### Boundary inventory

| Surface | Required boundary behavior |
| --- | --- |
| Client summary, Enable/Manage entry, command-center rail entry, drawer tab, quick-view link | Remove the descriptor and content, not only a button label. The ordinary client stays mounted. No feature discovery/summary request starts while unavailable. |
| Direct `?tab=co-managed`, relationship and section deep links | Wait while availability resolves; mount only when permitted. Disabled/denied targets fall back without exposing content or looping. No backend flag-dependent redirect or 404. |
| Setup, allocation, resend/retry/cancel, policy/SLA, delegated actions, departure/history | Protect their embeddable content and every portal-rendered dialog. Late responses after unmount cannot restore them. |
| Shortfall review, embedded checkout, account pool editor, license-return entry | Mount only while usable. Disabling during an open dialog removes it and stops UI polling. It does not revoke a submitted operation. |
| Global overview, filters, client links, pool controls, work/archive entry points | Apply the shared boundary to dedicated content and navigation. |
| Client Tickets shared-work view, combined export, shared project/task links | Feature UI disappears with the flag; native client work remains functional. |
| Legacy operation/client links | Gated presentation adapters must not fetch targets or open feature UI while the flag is unavailable. |
| Customer acceptance/settings/export/upgrade and existing shared-work screens | Retain original T21 coverage and re-run affected cases when extracting shared components. |

Do not use `TabContent.hideTrigger` as the boundary: it deliberately retains URL-addressable content. Do not eagerly invoke feature reads while constructing a tab descriptor. Boundary removal must include dialogs portaled outside a focus drawer.

### Required evidence

Use the original T21/T22 names when reporting inherited requirements. New test checklist IDs identify this plan's cases, not a replacement numbering for the original audit.

1. **Component composition:** parameterize disabled, loading, unknown, and error states on real client composition, not only the boundary primitive. Assert absent summary/tab/rail/dialog controls, no feature action calls, and working ordinary client content. Verify enabled, eligible composition on full page, drawer, and quick view. Toggle the flag off while setup and checkout are open; resolve a late promise and prove no remount or new side effect.
2. **Target/database evidence:** run migrated PostgreSQL happy/guard cases for sponsor-client resolution, multiple/ended relationships, forged/mismatched selections, record-policy redaction, concurrent duplicate setup, and stale writes. Verify existing customer-home actions. Add Citus evidence for any changed lookup/transaction/index path; do not substitute source-string assertions.
3. **Purchase evidence:** exercise the degradation matrix with adapter/component tests, plus existing real database purchase/reservation concurrency paths. Record actual configured Stripe test-mode checkout/reconciliation and signed-license return journeys separately from mocked payment tests.
4. **Hosted browser journey:** open a client, enter setup, buy a shortfall in test mode, wait for verified capacity, finish setup, observe pending acceptance, accept as customer admin, and manage seats/settings from that same client. Confirm global overview links back to it. Verify relationship-only and account-only roles separately.
5. **Self-host browser journey:** allocate signed capacity, encounter a shortfall, visit License Management, return and refresh the same draft. Exercise missing/expired claims and UI flag-off states. External issuer availability is a declared prerequisite; if absent, record that journey as blocked, not passed through fixture-only claims.
6. **T22 independence:** with UI flag off, authorized direct client-resolution/actions and existing purchase/provisioning/reconciliation still operate under their normal rules; unauthorized callers are still denied. No release-key check is added to API routes, server actions, services, migrations, or workers.
7. **Browser presentation:** capture full-page and drawer states, narrow viewport, keyboard/focus return, light/dark, and at least one translated locale. Refresh and reopen a direct client link; test pending deep links when flag/permissions resolve asynchronously.

For each execution record the revision, deployment mode/edition, role capabilities, flag state, scenario, expected and observed result, command or browser route, and artifact path. Mark unexecuted cases pending/blocked with their dependency. Sanitize credentials, checkout/invitation tokens, and customer identifiers in shared artifacts.

At M6, update:

- [feature-flags.md](../../features/feature-flags.md): new client composition, account pool editor, legacy adapters, dialog behavior, and exact flag semantics.
- [Original plan](../2026-09-06-co-managed-it-plan.md): Primary experience, UI-only release flag, implementation progress, and T21/T22 acceptance references.
- [T01–T07 audit](../co-managed-audit-t01-t07.md): client-target management, provisioning and purchase evidence affected by the new paths.
- [T08–T15 audit](../co-managed-audit-t08-t15.md): client-scoped combined work evidence.
- [T16–T22 audit](../co-managed-audit-t16-t22.md): a dated T21/T22 addendum distinguishing old screen evidence from the newly executed integration coverage.

Historical passes remain historical. The relocated UI is not accepted merely because the old global page or boundary helper passed.

## Milestones

Deliver in dependency order. Keep each checkpoint reviewable and update `features.json`, `tests.json`, and `SCRATCHPAD.md` with actual implementation/evidence.

| Milestone | Deliverables | Exit evidence |
| --- | --- | --- |
| M1: Client target and read contracts | Authorized per-client discovery/usage/actions DTO; shared selector/resolver; policy/SLA/delegation/departure adapters; exact relationship guards; legacy target mapping; duplicate-setup admission. | Migrated DB happy/denial/stale/multiple/ended/concurrent-setup cases; affected action tests; no new target-tenant input or changed operation identities. |
| M2: Client composition and discovery | Optional cross-feature seam, app injection, summary, stable tab/focus registration, Service rail grouping, drawer/quick-view behavior, deep-link cleanup and draft lifecycle. | Real client-composition component checks in enabled/unavailable states, asynchronous registration, client switch, duplicate instance IDs, and native-client fallback. |
| M3: Client relationship management | Extracted setup, progress/recovery, seats/usage, MSP assignments, approved scope, SLA, delegation and history/departure sections; client-fixed creation; mutation-driven refresh. | Representative client setup-to-acceptance and management paths; live seat/invitation guards and denied/stale settings tests; no redirect to the global editor. |
| M4: Contextual and account purchasing | Typed readiness and degradation states; shortfall-to-total conversion; shared purchase/recovery controller; account pool editor; self-host license return; independent billing/relationship loading. | Matrix tests, real database purchase/allocation recovery cases, provider test-mode journey and signed-license journey recorded separately. Successful purchase followed by failed allocation is recoverable without a second charge. |
| M5: Cross-client oversight and work entry | Overview table/status/filter/navigation; scoped totals; retirement of duplicate global forms; canonical legacy navigation; client-scoped combined ticket query and project/task entry points. | Authorized list/count/pagination/export checks and client/global navigation; native-plus-shared client ticket results; ended/hidden relationships do not leak work. |
| M6: T21/T22 acceptance and documentation | Full boundary inventory exercised, hosted/self-host browser evidence, affected CE/EE builds/typechecks, locale/theme checks, updated original plan/flag docs/audit addenda. | Required evidence linked to revision and environment, with no unsupported completion claims. All unexecuted dependencies remain explicit. |

M2 depends on M1's read contract. M3 depends on M1/M2. M4 reuses M3's draft and mutation state. M5 relies on the canonical client destination and completed management/purchase homes. Apply T21 during every milestone; M6 verifies the composed result.

## Verification and rollout

Extend focused existing suites: `server/src/test/unit/product/coManagedManagementActions.test.ts`, `coManagedClientAction.test.tsx`, `coManagedOverview.test.tsx`, `coManagedProvisioningPanel.test.tsx`, `coManagedFeatureBoundary.test.tsx`, affected policy/SLA/delegation/departure tests, and `ee/server/src/__tests__/unit/coManagedBillingActions.test.ts`/purchase suites. Update assertions that intentionally expect the old global-page redirect.

Use the existing migrated `coManagedReservations.integration.test.ts` and `coManagedBootstrap.integration.test.ts` harnesses for real query and admission coverage. Add representative cases instead of duplicating their complete backend matrices. Typecheck/build changed clients, composition, co-managed, licensing, server/EE packages and verify both edition alias paths. Run browser journeys against the feature revision, not a prebuilt image missing these changes.

Deploy additive adapters before retiring old UI ownership. Keep narrow operation-based compatibility action wrappers for existing callers during the transition; they resolve through the same authorization boundary, not a second permissive implementation. Preserve legacy routes. Feature-flag disable hides the new experience and leaves backend operations intact. UI rollback can restore the old composition while retaining the client-aware adapters; it must not undo purchased capacity or provisioning receipts. Any index migration must support the existing data and Citus constraints.

## Risks and decisions to verify during implementation

- Existing clients may map to multiple workspaces. The selector/history behavior above is required; adding a uniqueness constraint over existing data is not an acceptable shortcut.
- A missing provisioning mapping must produce a consistency error, not “not enabled,” when surviving sponsor references establish an existing relationship. Decide a repair path from actual data without recreating a customer workspace.
- The sponsor-local operation JSON currently carries `clientId`. Verify lookup performance with realistic list sizes before adding an index or normalized mapping. Never rewrite immutable request fingerprints to rename a navigation key.
- Current account and license navigation differ by deployment. Use their registered routes and permission checks; validate return navigation and incomplete external issuer/provider configuration through M4's matrix.
- Full-page client views are focus drawers. Nested dialogs and shared dirty-state handling need actual browser evidence; adding only a `tabContent` entry does not establish a complete client experience.

## Acceptance criteria

- An authorized MSP user can discover, enable, revisit, and manage a client's relationship without visiting the global provisioning editor.
- Setup fixes the local client, reserves once, remains pending until customer acceptance, and recovers the original operation after failure or refresh.
- Client, relationship, provisioning, purchase, and command identities remain distinct. Forged/stale/ambiguous selectors cannot operate on another relationship.
- Seat usage agrees with admission guards. Allocation and purchasing obey independent permissions and verified capacity.
- Every purchase-matrix state has a useful outcome; payment success is distinguished from entitlement reconciliation and client allocation success.
- The global page provides authorized cross-client oversight and leads to the client for management. Client work views preserve native/shared query correctness.
- Original T21 covers all relocated controls, direct links, and portaled dialogs. Original T22 remains true.
- Focused query/component tests, affected edition checks, and executed browser/provider evidence support the claims recorded in the updated documentation.
