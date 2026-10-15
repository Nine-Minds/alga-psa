import type { ProductCode } from './productCodes';
import { resolveProductCode } from './productCodes';

/**
 * Product-neutral navigation targets.
 *
 * Some destinations differ by product: the same capability lives on a different
 * page in PSA than it does in AlgaDesk or a co-managed workspace. The code that
 * renders the link usually cannot know the product — shared components in
 * `packages/integrations` have no session or product context, and OAuth
 * `returnTo` values are built before any page renders.
 *
 * Linking straight at the PSA page is what produced the co-managed provider
 * dead end: the product told a customer administrator to register its own
 * Microsoft Entra application and then sent it to `/msp/settings/integrations`,
 * which the co-managed product boundary denies.
 *
 * So links point at `/msp/go/<target>` and
 * `server/src/app/msp/go/[target]/route.ts` resolves the tenant's product
 * server-side and redirects. This is navigation only: it grants nothing, every
 * destination keeps its own product route rule, and the server actions behind
 * each page keep their own RBAC and tenant-ownership guards.
 */
export const PRODUCT_NAV_TARGETS = ['providers', 'mailbox'] as const;

export type ProductNavTarget = (typeof PRODUCT_NAV_TARGETS)[number];

export function isProductNavTarget(value: unknown): value is ProductNavTarget {
  return typeof value === 'string' && PRODUCT_NAV_TARGETS.includes(value as ProductNavTarget);
}

/** The link to render. Resolved by the dispatcher route, never rendered as-is. */
export function productNavHref(target: ProductNavTarget): string {
  return `/msp/go/${target}`;
}

/**
 * Where each target resolves per product.
 *
 * `co_managed` gets a capability-scoped provider route. It deliberately does
 * not get `/msp/settings/integrations`: that page also hosts accounting, RMM,
 * payments and the other categories the co-managed capability boundary
 * excludes, so allowing the route would widen the boundary well past the
 * provider capability.
 */
export const PRODUCT_NAV_DESTINATIONS: Record<ProductNavTarget, Record<ProductCode, string>> = {
  // Tenant-owned Google / Microsoft application credentials.
  providers: {
    psa: '/msp/settings/integrations?category=providers',
    algadesk: '/msp/settings/integrations?category=providers',
    co_managed: '/msp/co-management/providers',
  },
  // Connecting a mailbox to the configured application. PSA reaches the inbound
  // provider list through Integrations -> Communication; the restricted
  // products reach the same component through Settings -> Email -> Inbound.
  mailbox: {
    psa: '/msp/settings/integrations?category=communication',
    algadesk: '/msp/settings/email',
    co_managed: '/msp/settings/email',
  },
};

export function resolveProductNavDestination(
  target: ProductNavTarget,
  productCode: string | null | undefined,
): string {
  return PRODUCT_NAV_DESTINATIONS[target][resolveProductCode(productCode).productCode];
}

/** Convenience aliases for the two current targets. */
export const PROVIDER_SETUP_ENTRY_PATH = productNavHref('providers');
export const MAILBOX_SETUP_ENTRY_PATH = productNavHref('mailbox');
