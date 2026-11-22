# Make the first co-managed seat purchase discoverable

Draft · 2026-11-18

## Problem and outcome

A hosted Pro MSP buys a single co-managed seat pool and allocates it to clients using Seat or Workspace. Account Management already sells the first seats. The Co-Managed IT sidebar entry requires co-managed participation and `co_management:read`, both usually absent before the first purchase. The client setup panel can offer seats for a shortfall only after an administrator can open that panel.

An eligible account administrator should be able to find **Co-Managed IT** in MSP navigation, see the empty pool, review a first purchase, and see the purchased capacity when Stripe verifies payment. Buying the pool and choosing which clients receive seats are separate decisions.

## Who can enter

| Signed-in actor or tenant state | Expected experience at `/msp/co-managed` |
| --- | --- |
| Internal account administrator of a hosted Enterprise-edition PSA tenant on Pro, with account management read and update permissions and the purchase surface open | One sidebar link opens the sponsor overview. The administrator can start or recover the first purchase with no prior entitlement, client, allocation, or co-management permission. |
| Sponsor with existing arrangements or operational access | Existing overview, client visibility and read-only behavior follow the current product, capability, permission and client-scope rules. Purchase eligibility gives access only to the sponsor’s pool. |
| Co-managed customer workspace | The existing customer home follows its own access rules. |
| Community, self-hosted, manual-billing, non-Pro or other product, client portal user, seat technician, or actor without the necessary account permissions | The new discovery path is closed. Existing authorized surfaces, including self-host license management, retain their own access rules. |

Honor the configured co-managed price, the tenant-targeted release flag, and its existing force/kill-switch semantics. The first-purchase entry uses the purchase-surface policy for the shared pool. The Seat-shape rollout governs client setup independently. Stripe preview and confirmation retain live base-subscription, customer, product and price checks. Navigation uses local server-authoritative eligibility and requires no Stripe request.

## From navigation to paid seats

1. The sidebar and a direct visit resolve the same server-authorized root. A purchase-only visit shows the sponsor’s pool at zero, explains that seats can be allocated to clients after purchase, and offers **Buy co-managed seats**. Opening the page requires no client selection. Omit archive, client search, setup links and SLA administration for this actor. A `clientId` query parameter confers no additional authority.
2. The administrator selects a positive **total** pool quantity in the existing pool editor. Its review shows the recurring total, amount due now and currency from the configured Stripe price. Explicit confirmation starts the existing purchase operation. Dismissing the review leaves capacity and billing untouched.
3. During checkout, the same root and sidebar entry remain reachable while the actor is eligible. A refresh recovers a resumable operation with its original quantity. If the provider request has finished but paid capacity has yet to arrive, show an awaiting-verification state and allow the administrator to refresh. Starting a second first purchase in this interval must be prevented. Display verified capacity throughout, including when an unpaid observation has created a hosted entitlement row at zero.
4. Once the existing reconciliation verifies paid capacity, the overview shows the new purchased and available totals. The administrator can return to the overview after leaving checkout. An administrator who qualifies for client setup can continue from the client record using the existing Seat or Workspace flow. An account administrator without operational permissions can still see the purchase outcome. Purchase never creates a client arrangement or assigns a seat.

## Access and implementation

- Resolve commercial eligibility and operational access as separate facts for the authenticated principal and tenant. Share the commercial decision across sidebar, root layout, page and metadata so a visible entry leads to a usable page. When both access paths apply, render one Co-Managed IT link. Limit the commercial exception to the overview root. Keep the archive route and its navigation independently gated.
- Render pool-only content for a purchaser without operational access. Do not invoke overview/table readers, lazy sponsor permission admission or allocation actions from the purchase-only view. Preserve the ordinary customer home and served sponsor read paths, including lapsed relationships. A zero-capacity row alone establishes neither a successful purchase nor authority to expose operational content.
- Reuse the account editor, controller, purchase review, preview/purchase actions and Stripe reconciliation. Use the existing durable operation identity on resume. Distinguish in-flight, completed-but-unverified and verified outcomes from the sponsor’s persisted purchase and entitlement state. A checkout return, operation status or browser callback alone cannot raise capacity. A subsequent authenticated read must observe the result, including after webhook-only completion. Fresh purchase, access and resume checks must use the current actor’s tenant.
- Refresh server-derived access, capacity and relevant permission state at handoff. An admitted and authorized MSP administrator should be able to continue through the normal operational admission path from the same session. Lazy co-management grants belong to ordinary operational admission. Checkout must neither assign a custom role those grants nor restore permissions that an administrator removed.
- Place the new purchase policy, view and navigation contribution in EE. Use the edition composition seam at each shared host. The CE implementation stays inert even with a forced flag or a configured price. Coordinate the ownership of these touchpoints with the November 17 co-managed EE boundary plan, currently in progress. The historical paths in the scratchpad identify the behavior to extend through that move.

## Scope and rollout

This changes how an MSP discovers and completes its first purchase. Account Management remains a purchase entry point. The client setup shortfall still reviews the required **new pool total** and resumes the same allocation. Pricing, tax, SKU, base MSP user seats, the allocation model and signed self-host licensing remain under their existing owners. The [Seat and Workspace plan](../2026-11-10-co-managed-seat-and-workspace/PRD.md) defines the client flow.

Use the current purchase rollout and data model. No new entitlement, grant or backfill is needed to make an eligible tenant visible. The main rollout risk is treating a pending entitlement row as operational authorization or losing the link while sidebar permissions refresh. Verify both transitions on migrated data and exercise the CE host before release. No product decisions are outstanding.

## Acceptance criteria

- An eligible MSP account administrator with no entitlement or co-management grant can navigate to a zero-seat overview, review a quote and confirm a first purchase. Visiting or reviewing alone creates no purchase or operational grants.
- Returning during pending checkout recovers the same operation. A completed checkout awaiting verification offers no duplicate charge. A verified payment makes the correct sponsor’s seats visible exactly once, including after leaving the browser.
- The overview never exposes client data or operational actions through purchase eligibility. Account-only, operational-only and customer actors retain the appropriate outcome after reconciliation. A closed purchasing gate disables new discovery and purchase while existing served reads follow their own gates.
- Community and ineligible tenants cannot use the new commercial path by entering the URL or invoking billing actions directly. The Account Management editor and client setup shortfall flow continue to operate under their original conditions.
