# Appliance license purchase: the form → checkout handoff + distribution gate

Wires the one missing step in the appliance-license purchase flow — turning a
submitted "Appliance License Purchase" service request into a Stripe Checkout
redirect — and gates the whole purchase/license surface to the single Nine Minds
distribution tenant so it never appears in any other tenant's client portal.

## Where the flow stands today

The purchase is designed to run:

```
SR form (tier/seats/transport)
  → Stripe Checkout (metadata: is_license_order, service_request_submission_id, tier, seats, transport)
  → checkout.session.completed webhook → startApplianceLicenseIssuance → Temporal issuance
  → contract + document + JWT (+ claim code) → C6 "Appliance Licenses" view
```

Everything except the first arrow exists and works:

- The service-request template `appliance-license-order` and its `license-order-stripe`
  execution provider — `ee/server/src/lib/service-requests/providers.ts:487` and `:553`.
- `purchaseApplianceLicense(input)` — builds the Checkout Session with the right
  metadata and stamps the session id back on the submission —
  `ee/server/src/lib/actions/applianceLicenseActions.ts:55`.
- The webhook `handleLicenseOrderWebhook` → `startApplianceLicenseIssuance` →
  the Temporal `applianceLicenseIssuanceWorkflow` — `packages/integrations/src/webhooks/stripe/payments.ts:335`.
  This back half stays as-is; the webhook starts Temporal directly (no workflow-engine hop).

Two gaps:

1. **The missing arrow:** *nothing calls `purchaseApplianceLicense`.* Every reference
   to it is a comment. The `license-order-stripe` provider's `execute()` is a no-op
   that marks the submission `license-order-pending-payment` and defers checkout
   creation to a "portal UI" step that was never built. A customer fills the form,
   submits, and lands on a dead end — no redirect to Stripe.
2. **No distribution gate.** The license surface (client-portal sidebar nav,
   `/client-portal/licenses` page, and the `appliance-license-order` purchase
   template) is visible to *every* tenant. On the shared SaaS instance that means
   any MSP tenant's client portal would show the purchase flow — and, worse, a
   non-distribution tenant could author the purchase definition and run real
   Checkout sessions against Nine Minds' Stripe account (price ids are instance-level
   env, so they resolve for the whole box).

## Part A — the form → checkout handoff

Give the service-request execution result a generic `redirectUrl`. The
license-order provider already receives everything it needs in its execution
context (`submissionId`, `clientId`, and the `payload` holding `tier`/`seats`/
`transport` — see `ServiceRequestExecutionContext` in
`server/src/lib/service-requests/providers/contracts.ts`), so it can create the
checkout itself and return the URL. The portal submit action then redirects to it.

A `redirectUrl` channel keeps this reusable: any future "pay for this on submit"
request type uses the same path instead of another bespoke handoff. The channel is
generic plumbing; the license-specific policy (price map, metadata, C4 wiring)
stays contained in the `license-order-stripe` provider and the EE action.

### A1. Add `redirectUrl` to the execution result

`server/src/lib/service-requests/providers/contracts.ts` — `ServiceRequestExecutionResult`:

```ts
export interface ServiceRequestExecutionResult {
  status: 'succeeded' | 'failed';
  createdTicketId?: string;
  workflowExecutionId?: string;
  redirectUrl?: string;        // new — where the portal should send the user next
  errorSummary?: string;
}
```

### A2. Plumb it through the submit result

`server/src/lib/service-requests/submissionService.ts` — add `redirectUrl?: string`
to `SubmitPortalServiceRequestResult`, and carry `executionResult.redirectUrl` into
the succeeded return (the `status === 'succeeded'` branch, ~`:235`). It is
transient — do not persist it on `service_request_submissions`.

### A3. Extract a context-driven checkout creator

`ee/server/src/lib/actions/applianceLicenseActions.ts` — extract the body of
`purchaseApplianceLicense` into `createApplianceLicenseCheckout(input)` that takes
`knex`/`tenant` rather than calling `getSession()`/`createTenantKnex()` — the
submission has already authenticated the user, and the provider must not re-auth.
It performs validation, resolves the price id, creates the Checkout Session with
the **unchanged** metadata + `success_url`/`cancel_url`, and returns both the URL
and the session id. It does **not** write to the submission (persistence is the
caller's job — see A4 for why):

```ts
export interface CreateApplianceLicenseCheckoutInput {
  knex: Knex;
  tenant: string;
  submissionId: string;
  clientId: string;
  tier: ApplianceLicenseTier;
  seats: number;
  transport: ApplianceLicenseTransport;
}

export interface ApplianceLicenseCheckout {
  checkoutUrl: string;
  checkoutSessionId: string;
}

export async function createApplianceLicenseCheckout(
  input: CreateApplianceLicenseCheckoutInput
): Promise<ApplianceLicenseCheckout> { /* validate → price → stripe.checkout.sessions.create → return */ }
```

`purchaseApplianceLicense` stays as a thin `'use server'` wrapper: `getSession()`
for auth, `createTenantKnex()` for `knex`/`tenant`, delegate to
`createApplianceLicenseCheckout`, write the `stripe_session_<id>` stamp itself
(it runs outside the submission service), and return `{ checkoutUrl }`. It keeps
the authenticated direct-call entry available even though only the provider path
is wired today.

### A4. Make the provider create the checkout

`ee/server/src/lib/service-requests/providers.ts` — replace the no-op `execute()`
of `licenseOrderExecutionProvider` (`:558`):

```ts
async execute(context): Promise<ServiceRequestExecutionResult> {
  try {
    const tier = String(context.payload.tier) as ApplianceLicenseTier;
    const seats = parseInt(String(context.payload.seats), 10);
    const transport = String(context.payload.transport) as ApplianceLicenseTransport;
    const { checkoutUrl, checkoutSessionId } = await createApplianceLicenseCheckout({
      knex: context.knex,
      tenant: context.tenant,
      submissionId: context.submissionId,
      clientId: context.clientId,
      tier, seats, transport,
    });
    return {
      status: 'succeeded',
      workflowExecutionId: `stripe_session_${checkoutSessionId}`,
      redirectUrl: checkoutUrl,
    };
  } catch (e) {
    return { status: 'failed', errorSummary: e instanceof Error ? e.message : 'Checkout creation failed.' };
  }
}
```

The provider returns the `stripe_session_<id>` value as `workflowExecutionId` so
`submitPortalServiceRequest`'s success branch persists it on the submission. (The
submit service overwrites `workflow_execution_id` from the execution result, so
the provider must *return* the stamp rather than write it — writing it inside the
checkout creator would just be clobbered.) Webhook correlation is by checkout
**metadata** (`service_request_submission_id`), so this stamp is for traceability,
not the correlation key.

### A5. Redirect to checkout from the portal submit action

The portal form posts to a server action that performs a server-side `redirect()`,
so the redirect to Stripe happens there — no client-side change to
`RequestServiceForm.tsx`.

`server/src/app/client-portal/request-services/[definitionId]/actions.ts` —
`submitRequestServiceDefinitionAction`: carry `result.redirectUrl` out of the
transaction in the success outcome, then after the transaction, before the catalog
redirect:

```ts
if (outcome.redirectUrl) {
  redirect(outcome.redirectUrl);   // Next supports absolute/external URLs (Stripe Checkout)
}
```

## Part B — the distribution-tenant gate

One tenant — the Nine Minds distribution tenant — may show and sell appliance
licenses. Identify it with the established `MASTER_BILLING_TENANT_ID` env var
(already the gate for Nine-Minds-only features such as platform reports,
`ee/server/src/app/api/v1/platform-reports/route.ts:23,90`). A single predicate
covers both the tenant dimension (only Nine Minds matches) and the instance
dimension (on an appliance/self-host the var is unset → nothing matches → hidden).
**Fails closed.**

### B1. Shared helper

`packages/licensing/src/lib/license-state.ts` (auto-exported via the package barrel,
alongside `isSelfHostLicensing`):

```ts
/**
 * True only for the Nine Minds license-distribution tenant — the one tenant
 * allowed to author/sell appliance licenses in-app. Identified by
 * MASTER_BILLING_TENANT_ID. Fails closed: env unset (appliance/self-host or
 * misconfig) → no tenant matches → the distribution surface stays hidden.
 */
export function isLicenseDistributionTenant(tenant: string | null | undefined): boolean {
  const master = process.env.MASTER_BILLING_TENANT_ID;
  return !!master && !!tenant && tenant === master;
}
```

Synchronous env compare — no DB. Safe to import in server components, server
actions, and EE/server code. The client-side sidebar never imports it; it receives
the boolean as a prop computed server-side.

### B2. Client-portal sidebar nav

The "Licenses" nav item in `ClientPortalSidebar.tsx` (`:152`) is currently
unconditional. Gate it like `hasBillingAccess`:

- `checkClientPortalPermissions` (`packages/client-portal/src/actions/client-portal-actions/clientUserActions.ts:476`)
  has `{ tenant }` — add `isLicenseDistributor: isLicenseDistributionTenant(tenant)`
  to its return (and `false` in the catch).
- `ClientPortalLayout.tsx` `LayoutShell` — carry `isLicenseDistributor` through the
  permissions state and into the `<ClientPortalSidebar permissions={...}>` prop.
- `ClientPortalSidebar.tsx` — add `isLicenseDistributor: boolean` to
  `SidebarPermissions`; include the licenses item only when true.

### B3. Client-portal licenses page

`server/src/app/client-portal/licenses/page.tsx` — make it an async server
component that resolves the current user (`getCurrentUser()`) and redirects
non-distribution tenants away before rendering `ClientLicensesPage`:

```ts
const user = await getCurrentUser();
if (!user || !isLicenseDistributionTenant(user.tenant)) {
  redirect('/client-portal/dashboard');
}
```

### B4. Template authoring chokepoint

The `appliance-license-order` template is offered to MSP admins for authoring a
definition. The synchronous `listTemplates()` has no tenant, so gate where tenant
is in scope — `server/src/lib/service-requests/definitionManagement.ts`:

- `listServiceRequestTemplateOptions(tenant)` — accept `tenant`; filter out the
  `appliance-license` provider's templates when `!isLicenseDistributionTenant(tenant)`.
- `createServiceRequestDefinitionFromTemplate({ ..., tenant })` already has tenant —
  reject creation when the requested template belongs to the `appliance-license`
  provider and `!isLicenseDistributionTenant(tenant)` (defense in depth, so a
  direct action call can't author it either).
- Thread `tenant` from the two MSP callers in
  `server/src/app/msp/service-requests/actions.ts` (both `withAuth`, tenant in
  context).

This is the real upstream control: because published definitions are per-tenant,
gating *authoring* to the distribution tenant means the purchase definition can
only ever exist — and therefore only ever appear in a client-portal catalog — in
the Nine Minds tenant.

### B5. Execution-layer hard gate

`createApplianceLicenseCheckout` (`ee/server/src/lib/actions/applianceLicenseActions.ts`)
throws unless `isLicenseDistributionTenant(input.tenant)`. This is the chokepoint
that holds regardless of how a definition was authored — template, *manual*
execution-provider selection on a blank definition (the `license-order-stripe`
provider is in the registry and would otherwise be selectable), or a direct action
call. Without it, a non-distribution MSP admin on the shared SaaS box could wire a
definition to `license-order-stripe` and run real Checkout sessions against Nine
Minds' Stripe account (price ids are instance-level env). With it, no authoring
path can bill the distributor's account.

## Behavior at the seams

- **Fails closed everywhere.** With `MASTER_BILLING_TENANT_ID` unset (appliances,
  self-host, or a misconfigured SaaS box) no tenant is the distributor, so the
  entire surface is hidden and no checkout can be authored.
- **After payment.** `success_url` returns the customer to
  `/client-portal/licenses?checkout=success`; issuance is webhook-driven and async,
  so that view may briefly show no contract until the Temporal workflow finishes.

## Out of scope

- Routing issuance through the workflow engine — the webhook starts Temporal
  directly and that is intended.
- Generalizing checkout/fulfillment into a data-driven capability — considered and
  declined (single use case; widens the appliance attack surface).
- **Whether shipping this issuance path in the appliance image gives an appliance
  operator a route to self-issue a license — tracked as a separate security
  review.** (The UI gates here are correctness/trust, not the cryptographic
  boundary; C4 signing remains the defense.)
