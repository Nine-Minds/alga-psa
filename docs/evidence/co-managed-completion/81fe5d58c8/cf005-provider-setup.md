# CF005 / CF006 — customer provider setup dead end

## What was broken

A co-managed customer administrator is told by the product to register its own Microsoft Entra
application. Settings → Email → Inbound → **Open Providers** navigated to
`/msp/settings/integrations?category=providers`, and the co-managed product boundary rendered
"Page not available in your current product experience". The only surface that can store the
application the product just asked for was blocked.

Four more links reached the same blocked page or another blocked page: the two "Open Providers"
entries in `MicrosoftProviderForm`, the Microsoft email-setup `returnTo`, the admin-consent callback
`returnTo`, and — inside the providers workbench itself — "Connect a mailbox →", which pushed to
`/msp/settings/integrations?category=communication`.

Root shape: shared components in `packages/integrations` and OAuth `returnTo` builders link at a
**product-specific page** from code that cannot know the product. There is no session context in
those components, and `returnTo` is built before any page renders.

## Why the obvious fix is wrong

Allowing `/msp/settings/integrations` for `co_managed` — even scoped by category inside the page —
is not acceptable. That page also hosts accounting, RMM, payments, identity and (in EE)
it-documentation and calendar. Putting the route inside the product boundary would move the line
from "one capability" to "the whole integrations surface, held back only by an in-component filter".
The route stays `not_found`.

## What landed

| Change | File |
| --- | --- |
| Product-neutral navigation targets and their per-product destinations | `packages/types/src/constants/productRoutes.ts` |
| One dispatcher route handler that resolves the tenant's product server-side and 307s | `server/src/app/msp/go/[target]/route.ts` |
| Capability-scoped page rendering `ProviderCredentialsWorkbench` alone | `server/src/app/msp/co-management/providers/page.tsx`, `server/src/components/co-managed/CoManagedProviderSetup.tsx` |
| Five links + the in-workbench mailbox link rewired | `EmailProviderConfiguration.tsx`, `MicrosoftProviderForm.tsx` (×2), `microsoftActions.ts`, `email-setup/callback/route.ts`, `MicrosoftIntegrationSettings.tsx` |
| Reverse entry from identity setup | `server/src/components/settings/security/MspSsoAdvancedSection.tsx` |
| Regression | `server/src/test/unit/product/providerSetupReachability.test.ts` |

`/msp/co-management/providers` is covered by the existing `msp_co_management_policy` route rule
(`psa: allowed, algadesk: not_found, co_managed: allowed`), so no new product exemption was created.
The page is wrapped in `CoManagedFeatureBoundary` like every other co-management page.

The dispatcher is a route handler, not a page, so no client layout renders for it and no product
route boundary is evaluated against the dispatcher path itself. An unknown target returns 404 rather
than redirecting to a caller-supplied path.

## Guards

Nothing was relaxed. The reused surface is the one PSA uses:

- **Product boundary** — the route rule. `/msp/settings/integrations` and `/msp/integrations` stay
  `not_found` for `co_managed`.
- **RBAC** — unchanged inside the provider actions: `system_settings:update` via
  `canManageMicrosoftSettings` / `hasPermission`, plus the not-a-client-portal-user rejection.
  `server/migrations/utils/permissions/catalog.cjs` already grants `system_settings` to
  `co_managed: ['msp:Admin']`, so this is the permission the product already intended.
- **Tenant ownership and secret redaction** — the actions' own; no new persistence was written.
- **Release flag** — `release-v1-6-feature` is read only by `CoManagedFeatureBoundary` and other
  client components. The **denials** are decided by `resolveProductRouteBehavior(productCode,
  pathname)`, which takes no flag. No backend flag was introduced. This was originally recorded as a
  structural claim; it has since been walked with the flag forced off — see below, and note that the
  walk **disproved** part of what was assumed.

## The release flag, walked rather than reasoned about

The route was first shipped wrapped in `CoManagedFeatureBoundary` with no `fallback`, which that
component's contract says makes a whole-route caller "render blank when the flag is off". The
expected consequence was that a co-managed customer clicking **Open Providers** with the flag off
would get a blank page instead of the boundary card.

Forced off and walked, as `cm.rabbit.admin@whiterabbit.test`:

```bash
NEXT_PUBLIC_FORCE_FEATURE_FLAGS='release-v1-6-feature:false'
```

(`NEXT_PUBLIC_DISABLE_FEATURE_FLAGS` is the wrong lever: `useFeatureFlag` treats it as force-**enable**.)

| Route | `main` innerText length, flag off |
| --- | --- |
| `/msp/dashboard` | 0 |
| `/msp/tickets` | 0 |
| `/msp/settings/email` | 0 |
| `/msp/co-management/ticket-access` | 0 |
| `/msp/co-management/providers` | 0 |

**The blanking is shell-wide, not route-specific.** `MspLayoutClient` wraps the entire MSP shell in
`CoManagedWorkspaceBoundary`, which is `CoManagedFeatureBoundary` for `product_code: co_managed`.
With the flag off a co-managed tenant has no application at all, so the customer could never reach
Settings → Email to click Open Providers, and the route-level wrapper changed nothing observable.
The expected consequence above did not occur.

The wrapper was still removed, for the reasons now recorded in `providers/page.tsx`: redundant for
`co_managed` given the shell gate; for `psa` — which this route's rule also allows and which the
shell boundary does not wrap — it was the only gate, over a surface PSA already reaches unflagged;
and if the shell blanking is ever given the fallback it lacks, a surviving gate here would create the
dead end for real, because the Open Providers entry point is gated only on enterprise edition.

With the flag restored, `/msp/go/providers` renders the workbench again: `main` innerText 1697
characters, `#provider-credentials-selector` present.

### A larger defect this surfaced — reported, not fixed

An entire product's UI rendering empty, with no fallback and no explanation, is a real defect. It is
pre-existing and shell-owned (`MspLayoutClient` / `CoManagedFeatureBoundary`), well outside this
card's provider-setup scope, and fixing it means deciding what a co-managed tenant should see when
the release flag is off — a product decision, not a repair. Recorded in the manifest as open defect
`co-managed-shell-blank-with-flag-off`.

## Browser walkthrough

Real dev app `http://100.82.172.57:3374`, signed in as `cm.rabbit.admin@whiterabbit.test`
(tenant `51ac6952-6d6f-4600-aace-b71a9b2a5e73`). Session identity confirmed through
`/api/auth/session`: `product_code: "co_managed"`.

| Step | Result |
| --- | --- |
| `/msp/settings/integrations?category=providers` direct | **"Page not available — This page is not available in your current product experience."** Boundary intact. |
| Settings → Email → Inbound → **Open Providers** | Lands on `/msp/co-management/providers`, title **"Email and Identity Providers"**, back link "Back to Email settings". |
| Microsoft tab on that page | Renders the app-registration surface: "Manage your company's Microsoft app registrations…", "Manual Microsoft apps (advanced)", "New app registration", "Which Microsoft app each service uses". This is exactly what was previously unreachable. |
| `/msp/settings/integrations?category=accounting` | Page not available |
| `/msp/settings/integrations/entra` | Page not available |
| `/msp/billing` | Page not available |
| `/msp/settings/extensions` | Page not available |

| `/msp/go/mailbox` (the return path out of the workbench) | Redirects to `/msp/settings/email`, title "Email \| AlgaPSA", not denied. Previously this pushed to `integrations?category=communication`, which is denied. |
| `/msp/go/not-a-target` | **HTTP 404**, not a redirect. The dispatcher will not forward to a caller-supplied path. |

PSA unchanged, verified in the same browser as `cm.msp.admin@oz.test` (`product_code: "psa"`):
`/msp/go/providers` → `/msp/settings/integrations?category=providers`, title "Integrations".

Screenshot: `screenshots/cf005-co-managed-providers.png`, committed alongside this document. It
shows the page as tenant `51ac6952-6d6f-4600-aace-b71a9b2a5e73`: "Email and identity providers",
"Back to Email settings", the Google/Microsoft selector, and the Microsoft panel with "New app
registration", "Microsoft Entra", "Reconnect Microsoft services" and the per-service app mapping.
A screenshot is corroboration, not proof — the durable claims are the recorded DOM text above and
the regression below.

## Regression and mutation proof

```
$ cd server && SKIP_DB_TESTS=1 npx vitest run \
    src/test/unit/product/providerSetupReachability.test.ts \
    src/test/unit/product/coManagedProductSurface.test.ts \
    src/test/unit/product/uiReachabilityCoherence.contract.test.ts
  Test Files  3 passed (3)      Tests  41 passed (41)
```

Mutation: `PRODUCT_NAV_DESTINATIONS.providers.co_managed` reverted to
`/msp/settings/integrations?category=providers`:

```
 × routes every product to a destination that product is allowed to open
 × keeps the co-managed destination capability-scoped instead of exempting the integrations page
      Tests  2 failed | 4 passed (6)
```

Also rerun green: `packages/integrations` `microsoftProviders.providersFirst.test.ts`,
`microsoftEmailSetupActions.test.ts`, `microsoftEmailSetup.test.ts` (18 tests).

## Found but deliberately not fixed

**AlgaDesk has the identical dead end.** `/msp/settings/integrations` is `not_found` for
`algadesk`, and an enterprise-edition AlgaDesk tenant still renders the "Open Providers" entry. It is
out of this card's scope and is recorded, with its reason, in `UNRESOLVED_NAV_DESTINATIONS` in
`providerSetupReachability.test.ts` rather than being silently passed.

**`uiReachabilityCoherence.contract.test.ts` does not run for `co_managed`** — its `PRODUCTS` array
is `['algadesk', 'psa']`. That contract is exactly the one that would have caught this defect class
("a UI entry point that survives the product filter must resolve to an allowed route"). Widening it
is a real improvement and a real risk of surfacing many unrelated co-managed nav gaps; it was not
attempted in this round. Reported as open.

## Not established

- No OAuth callback was completed against a real Microsoft application. CF007 owns that.
- Cross-tenant callback denial and secret redaction on save were not exercised.
- No inbound mail was delivered through a customer-configured provider. CF008 owns that.
