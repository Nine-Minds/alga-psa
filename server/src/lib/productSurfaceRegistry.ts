import { PRODUCT_CODES, type ProductCode } from '@alga-psa/types';
import { getAllowedSettingsTabIds, isSettingsRestrictedProduct } from './settingsProductTabs';

export type ProductRouteBehavior = 'allowed' | 'upgrade_boundary' | 'not_found';
export type ProductApiBehavior = 'allowed' | 'denied';

export interface RouteRule {
  group: string;
  staticPrefixes?: readonly string[];
  dynamicPatterns?: readonly RegExp[];
  behaviorByProduct: Record<ProductCode, ProductRouteBehavior>;
}

export interface ApiRule {
  group: string;
  staticPrefixes?: readonly string[];
  dynamicPatterns?: readonly RegExp[];
  behaviorByProduct: Record<ProductCode, ProductApiBehavior>;
  visibleInMetadataByProduct: Record<ProductCode, boolean>;
}

export { PRODUCT_CAPABILITIES } from '@alga-psa/types';

export const MSP_ROUTE_RULES: readonly RouteRule[] = [
  {
    group: 'msp_dashboard',
    staticPrefixes: ['/msp/dashboard'],
    behaviorByProduct: { psa: 'allowed', algadesk: 'allowed', co_managed: 'allowed' },
  },
  {
    group: 'msp_settings_excluded',
    staticPrefixes: [
      '/msp/settings/sla',
      '/msp/settings/notifications',
      '/msp/settings/extensions',
      '/msp/settings/integrations',
      '/msp/integrations',
    ],
    behaviorByProduct: { psa: 'allowed', algadesk: 'not_found', co_managed: 'not_found' },
  },
  {
    group: 'msp_core_helpdesk',
    staticPrefixes: ['/msp/tickets', '/msp/create-ticket', '/msp/clients', '/msp/contacts', '/msp/interactions', '/msp/knowledge-base', '/msp/reports', '/msp/settings', '/msp/profile', '/msp/security-settings', '/msp/account', '/msp/add-ons'],
    behaviorByProduct: { psa: 'allowed', algadesk: 'allowed', co_managed: 'allowed' },
  },
  {
    group: 'msp_upgrade_boundary',
    staticPrefixes: [
      '/msp/billing',
      '/msp/projects',
      '/msp/assets',
      '/msp/credentials',
      '/msp/documents',
      '/msp/jobs',
      '/msp/user-activities',
      '/msp/schedule',
      '/msp/technician-dispatch',
      '/msp/time-entry',
      '/msp/time-sheet-approvals',
      '/msp/workflow-editor',
      '/msp/workflow-control',
      '/msp/surveys',
      '/msp/extensions',
      '/msp/service-requests',
      '/msp/opportunities',
      '/msp/create-opportunity',
      '/msp/marketing',
    ],
    behaviorByProduct: { psa: 'allowed', algadesk: 'upgrade_boundary', co_managed: 'not_found' },
  },
  {
    // The one sponsor-prefix screen a co_managed customer also uses: its own Effective access and delegated
    // administration. /msp/co-management has no rule of its own, so the rest of that prefix stays closed to
    // co_managed (unmatched means not_found); the page and its actions still decide, per side, what the caller may see.
    group: 'msp_co_managed_administration',
    staticPrefixes: ['/msp/co-management/administration'],
    behaviorByProduct: { psa: 'allowed', algadesk: 'not_found', co_managed: 'allowed' },
  },
  {
    // Sponsor-only queue of tickets customers shared with the sponsor, and its shared-ticket screen. Only a PSA
    // sponsor has them; the capability gate in the route layout decides whether a PSA tenant sees them.
    group: 'msp_co_managed_customer_tickets',
    staticPrefixes: ['/msp/co-management/customer-tickets'],
    behaviorByProduct: { psa: 'allowed', algadesk: 'not_found', co_managed: 'not_found' },
  },
  {
    // Sponsor-only Shared Tasks queue and the shared project / task screens for projects customers share with the
    // sponsor. Only a PSA sponsor has them; the capability gate in each page decides whether a PSA tenant sees them.
    group: 'msp_co_managed_shared_projects',
    staticPrefixes: ['/msp/co-management/tasks', '/msp/co-management/projects'],
    behaviorByProduct: { psa: 'allowed', algadesk: 'not_found', co_managed: 'not_found' },
  },
  {
    // Customer-owned Google / Microsoft provider setup. The page itself is
    // gated by the co-managed capability ('serves'), so a co_managed workspace
    // reaches this one capability-scoped page without the wider integrations
    // surface.
    group: 'msp_co_management_providers',
    staticPrefixes: ['/msp/co-management/providers'],
    behaviorByProduct: { psa: 'allowed', algadesk: 'not_found', co_managed: 'allowed' },
  },
  {
    // One side-aware co-managed root: a PSA sponsor sees the overview, a
    // co_managed customer sees its own relationship home. The capability gate
    // in the route layout decides whether a tenant may see either.
    group: 'msp_co_managed_sponsor',
    staticPrefixes: ['/msp/co-managed'],
    behaviorByProduct: { psa: 'allowed', algadesk: 'not_found', co_managed: 'allowed' },
  },
  {
    group: 'msp_internal_not_found',
    staticPrefixes: ['/msp/test'],
    behaviorByProduct: { psa: 'allowed', algadesk: 'not_found', co_managed: 'not_found' },
  },
];

export const PORTAL_ROUTE_RULES: readonly RouteRule[] = [
  {
    group: 'portal_helpdesk_root_alias',
    dynamicPatterns: [/^\/client-portal$/],
    behaviorByProduct: { psa: 'allowed', algadesk: 'allowed', co_managed: 'allowed' },
  },
  {
    group: 'portal_helpdesk',
    staticPrefixes: ['/client-portal/dashboard', '/client-portal/tickets', '/client-portal/knowledge-base', '/client-portal/profile', '/client-portal/client-settings'],
    behaviorByProduct: { psa: 'allowed', algadesk: 'allowed', co_managed: 'allowed' },
  },
  {
    group: 'portal_upgrade_or_not_found',
    staticPrefixes: [
      '/client-portal/billing',
      '/client-portal/projects',
      '/client-portal/devices',
      '/client-portal/documents',
      '/client-portal/appointments',
      '/client-portal/request-services',
      '/client-portal/extensions',
    ],
    behaviorByProduct: { psa: 'allowed', algadesk: 'upgrade_boundary', co_managed: 'not_found' },
  },
];

export const API_RULES: readonly ApiRule[] = [
  {
    // Authenticated app-internal stream used by ticket and project list smart
    // search. It is not part of the public v1 metadata surface.
    group: 'api_smart_search',
    staticPrefixes: ['/api/smart-search'],
    behaviorByProduct: { psa: 'allowed', algadesk: 'allowed', co_managed: 'allowed' },
    visibleInMetadataByProduct: { psa: false, algadesk: false, co_managed: false },
  },
  {
    // Session-authenticated capability probes (/api/v1/capabilities/<key>).
    // Every product may ask about its own tenant; the capability gate inside
    // the route decides the answer (closed => the NotFound 404). Not part of
    // the public v1 metadata surface.
    group: 'api_capability_probes',
    staticPrefixes: ['/api/v1/capabilities'],
    behaviorByProduct: { psa: 'allowed', algadesk: 'allowed', co_managed: 'allowed' },
    visibleInMetadataByProduct: { psa: false, algadesk: false, co_managed: false },
  },
  {
    // Authenticated app-internal endpoint that mints the short-lived realtime
    // notification-signals token. Not part of the public v1 metadata surface.
    group: 'api_notification_stream',
    staticPrefixes: ['/api/notifications'],
    behaviorByProduct: { psa: 'allowed', algadesk: 'allowed', co_managed: 'allowed' },
    visibleInMetadataByProduct: { psa: false, algadesk: false, co_managed: false },
  },
  {
    group: 'api_ticket_psa_only_subroutes',
    staticPrefixes: [
      '/api/v1/tickets/from-asset',
    ],
    dynamicPatterns: [
      /^\/api\/v1\/tickets\/[^/]+\/time-entries(?:\/.*)?$/,
      /^\/api\/v1\/tickets\/[^/]+\/materials(?:\/.*)?$/,
      /^\/api\/v1\/tickets\/[^/]+\/assets(?:\/.*)?$/,
    ],
    behaviorByProduct: { psa: 'allowed', algadesk: 'denied', co_managed: 'denied' },
    visibleInMetadataByProduct: { psa: true, algadesk: false, co_managed: false },
  },
  {
    // Notification settings are PSA-only in the UI (/msp/settings/notifications),
    // so editing the same templates over the API follows them.
    group: 'api_email_templates_psa_only',
    staticPrefixes: [
      '/api/v1/email/templates',
    ],
    behaviorByProduct: { psa: 'allowed', algadesk: 'denied', co_managed: 'denied' },
    visibleInMetadataByProduct: { psa: true, algadesk: false, co_managed: false },
  },
  {
    group: 'api_helpdesk_allowed',
    staticPrefixes: [
      '/api/v1/meta',
      '/api/v1/tickets',
      '/api/v1/comments',
      '/api/ticket-comment-attachments',
      '/api/v1/clients',
      '/api/v1/contacts',
      '/api/v1/boards',
      '/api/v1/statuses',
      '/api/v1/priorities',
      '/api/v1/countries',
      '/api/v1/tags',
      '/api/v1/knowledge-base',
      '/api/v1/kb-articles',
      '/api/v1/email',
      '/api/email/oauth',
      '/api/email/imap',
      '/api/v1/users',
      '/api/v1/teams',
      '/api/v1/interactions',
      '/api/v1/interaction-types',
      '/api/v1/interaction-statuses',
      '/api/v1/mobile/me/capabilities',
    ],
    behaviorByProduct: { psa: 'allowed', algadesk: 'allowed', co_managed: 'allowed' },
    visibleInMetadataByProduct: { psa: true, algadesk: true, co_managed: false },
  },
  {
    // Exact path only (POST /api/v1/documents attach endpoint, used by MCP attach_file).
    // Deliberately a dynamic pattern: a static prefix would also open /api/v1/documents/*.
    // Per-entity availability (PSA-only entities) is enforced by the entity adapters.
    group: 'api_document_attach',
    dynamicPatterns: [/^\/api\/v1\/documents$/],
    behaviorByProduct: { psa: 'allowed', algadesk: 'allowed', co_managed: 'allowed' },
    visibleInMetadataByProduct: { psa: true, algadesk: true, co_managed: false },
  },
  {
    group: 'api_psa_only',
    staticPrefixes: [
      '/api/v1/billing',
      '/api/v1/invoices',
      '/api/v1/projects',
      '/api/v1/assets',
      '/api/v1/asset-groups',
      '/api/v1/asset-statuses',
      '/api/v1/asset-custody',
      '/api/v1/time-entries',
      '/api/v1/stopwatch',
      '/api/v1/workflows',
      '/api/v1/extensions',
      '/api/v1/surveys',
      '/api/v1/chat',
      '/api/v1/documents',
      '/api/v1/financial',
      '/api/v1/quotes',
      '/api/v1/contracts',
      '/api/v1/contract-lines',
      '/api/v1/services',
      '/api/v1/service-types',
      '/api/v1/products',
      '/api/v1/accounting-exports',
      '/api/v1/platform',
      '/api/v1/platform-admin',
      '/api/v1/admin',
      '/api/v1/tenant',
      '/api/v1/feature-flags',
      '/api/v1/workflow',
      '/api/v1/rmm',
      '/api/v1/scheduling',
      '/api/v1/dispatch',
      '/api/v1/time-sheet-approvals',
      '/api/v1/project',
      '/api/v1/integrations',
      '/api/v1/marketing',
      '/api/v1/inventory',
      '/api/v1/opportunities',
    ],
    behaviorByProduct: { psa: 'allowed', algadesk: 'denied', co_managed: 'denied' },
    visibleInMetadataByProduct: { psa: true, algadesk: false, co_managed: false },
  },
  {
    // Public (unauthenticated) marketing endpoints: capture-form submission,
    // email open/click tracking, unsubscribe. PSA-only like the module; they
    // are not v1 API surface, so they never appear in /api/v1/meta metadata.
    group: 'api_marketing_public',
    staticPrefixes: [
      '/api/marketing',
    ],
    behaviorByProduct: { psa: 'allowed', algadesk: 'denied', co_managed: 'denied' },
    visibleInMetadataByProduct: { psa: false, algadesk: false, co_managed: false },
  },
  {
    // Alga Migration Package (AMP) import workspace: tenant-scoped upload,
    // spreadsheet conversion, dry-run reporting and export endpoints, gated
    // by the import_export permission. Administrative onboarding surface, not
    // v1 API, so it never appears in /api/v1/meta metadata. PSA-only.
    group: 'api_amp_migrations',
    staticPrefixes: [
      '/api/migrations',
    ],
    behaviorByProduct: { psa: 'allowed', algadesk: 'denied', co_managed: 'denied' },
    visibleInMetadataByProduct: { psa: false, algadesk: false, co_managed: false },
  },
  {
    // SCIM 2.0 service provider for directory-driven user lifecycle. Entra
    // authenticates with a tenant-scoped bearer token, so these endpoints are
    // not v1 API surface and never appear in /api/v1/meta metadata. PSA-only,
    // matching the Pro-tier SCIM_PROVISIONING feature.
    group: 'api_scim_provisioning',
    staticPrefixes: [
      '/api/scim',
    ],
    behaviorByProduct: { psa: 'allowed', algadesk: 'denied', co_managed: 'denied' },
    visibleInMetadataByProduct: { psa: false, algadesk: false, co_managed: false },
  },
  {
    // Telephony provider webhooks (Microsoft Graph callRecords notifications).
    // Graph authenticates with the per-subscription clientState secret the
    // route verifies, so these are not v1 API surface and never appear in
    // /api/v1/meta metadata. PSA-only, matching the Microsoft Teams integration.
    group: 'api_telephony_webhooks',
    staticPrefixes: [
      '/api/telephony',
    ],
    behaviorByProduct: { psa: 'allowed', algadesk: 'denied', co_managed: 'denied' },
    visibleInMetadataByProduct: { psa: false, algadesk: false, co_managed: false },
  },
  {
    // Label printing (POST /api/labels/pdf): session-authenticated render of
    // ticket, asset and stock-unit labels through the PSA document-layout
    // renderer. App-internal, not v1 API, so it never appears in /api/v1/meta
    // metadata. PSA-only, like the asset/inventory records and the layouts.
    group: 'api_label_printing',
    staticPrefixes: [
      '/api/labels',
    ],
    behaviorByProduct: { psa: 'allowed', algadesk: 'denied', co_managed: 'denied' },
    visibleInMetadataByProduct: { psa: false, algadesk: false, co_managed: false },
  },
];

function normalizePathname(pathname: string): string {
  if (pathname.startsWith('/desk/')) {
    return pathname.replace('/desk/', '/msp/');
  }

  if (pathname === '/desk') {
    return '/msp';
  }

  return pathname;
}

export function matchesStaticPrefix(pathname: string, prefixes: readonly string[]): boolean {
  return prefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

export function matchesDynamicPattern(pathname: string, patterns: readonly RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(pathname));
}

function matchesRule(pathname: string, rule: Pick<RouteRule | ApiRule, 'staticPrefixes' | 'dynamicPatterns'>): boolean {
  const normalized = normalizePathname(pathname);
  if (rule.staticPrefixes && matchesStaticPrefix(normalized, rule.staticPrefixes)) return true;
  if (rule.dynamicPatterns && matchesDynamicPattern(normalized, rule.dynamicPatterns)) return true;
  return false;
}

// '/msp/settings/<segment>[/...]' → '<segment>'; null for the settings home and non-settings paths.
function mspSettingsSegment(pathname: string): string | null {
  const normalized = normalizePathname(pathname.split(/[?#]/)[0]);
  if (!normalized.startsWith('/msp/settings/')) return null;
  return normalized.slice('/msp/settings/'.length).split('/')[0] || null;
}

export function resolveProductRouteBehavior(productCode: ProductCode, pathname: string): ProductRouteBehavior {
  // Settings tab routes are gated per-segment against the same allow-list SettingsTab
  // uses, so the split-out /msp/settings/<tab> routes keep the pre-split ?tab= boundary.
  const settingsSegment = mspSettingsSegment(pathname);
  if (settingsSegment !== null && isSettingsRestrictedProduct(productCode)) {
    return getAllowedSettingsTabIds(productCode).has(settingsSegment) ? 'allowed' : 'not_found';
  }

  const rules =
    pathname === '/client-portal' || pathname.startsWith('/client-portal/') ? PORTAL_ROUTE_RULES : MSP_ROUTE_RULES;
  const matched = rules.find((rule) => matchesRule(pathname, rule));
  if (!matched) {
    return productCode === 'psa' ? 'allowed' : 'not_found';
  }

  return matched.behaviorByProduct[productCode];
}

export function resolveProductApiBehavior(productCode: ProductCode, path: string): ProductApiBehavior {
  const matched = API_RULES.find((rule) => matchesRule(path, rule));
  if (!matched) {
    return productCode === 'psa' ? 'allowed' : 'denied';
  }

  return matched.behaviorByProduct[productCode];
}

export function isApiVisibleInMetadata(productCode: ProductCode, path: string): boolean {
  const matched = API_RULES.find((rule) => matchesRule(path, rule));
  if (!matched) {
    return productCode === 'psa';
  }

  return matched.visibleInMetadataByProduct[productCode];
}

export function getApiMetadataProducts(path: string): ProductCode[] {
  return PRODUCT_CODES.filter((productCode) => isApiVisibleInMetadata(productCode, path));
}

type MenuLikeItem = { href?: string; subItems?: MenuLikeItem[] };
type MenuLikeSection<T extends MenuLikeItem> = { items: T[] };

function includeByHref(productCode: ProductCode, href?: string): boolean {
  if (!href || href.startsWith('http')) return true;
  if (isSettingsRestrictedProduct(productCode) && href.startsWith('/msp/settings?tab=')) {
    const tab = new URLSearchParams(href.split('?')[1]).get('tab');
    return tab ? getAllowedSettingsTabIds(productCode).has(tab) : false;
  }
  if (href.startsWith('/msp/')) return resolveProductRouteBehavior(productCode, href) === 'allowed';
  if (href.startsWith('/client-portal/')) return resolveProductRouteBehavior(productCode, href) === 'allowed';
  return productCode === 'psa';
}

export function filterMenuSectionsByProduct<T extends MenuLikeItem, S extends MenuLikeSection<T>>(
  productCode: ProductCode,
  sections: readonly S[],
): S[] {
  return sections
    .map((section) => ({
      ...section,
      items: section.items
        .map((item) => {
          const filteredSubItems = item.subItems?.filter((subItem) => includeByHref(productCode, subItem.href));
          if (item.subItems && (!filteredSubItems || filteredSubItems.length === 0)) {
            return null;
          }

          if (!item.subItems && !includeByHref(productCode, item.href)) {
            return null;
          }

          return {
            ...item,
            ...(filteredSubItems ? { subItems: filteredSubItems } : {}),
          };
        })
        .filter(Boolean) as T[],
    }))
    .filter((section) => section.items.length > 0);
}

export function filterPortalNavigationByProduct<T extends { href: string }>(
  productCode: ProductCode,
  navItems: readonly T[],
): T[] {
  return navItems.filter((item) => resolveProductRouteBehavior(productCode, item.href) === 'allowed');
}
