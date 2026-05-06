import type { ProductCode } from '@alga-psa/types';

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

export const PRODUCT_CAPABILITIES = {
  psa: ['*'],
  algadesk: [
    'dashboard',
    'tickets',
    'clients',
    'contacts',
    'knowledge_base',
    'settings',
    'client_portal',
    'email_to_ticket',
  ],
} as const;

export const MSP_ROUTE_RULES: readonly RouteRule[] = [
  {
    group: 'msp_dashboard',
    staticPrefixes: ['/msp/dashboard'],
    behaviorByProduct: { psa: 'allowed', algadesk: 'allowed' },
  },
  {
    group: 'msp_settings_excluded',
    staticPrefixes: ['/msp/settings/sla'],
    behaviorByProduct: { psa: 'allowed', algadesk: 'not_found' },
  },
  {
    group: 'msp_core_helpdesk',
    staticPrefixes: ['/msp/tickets', '/msp/clients', '/msp/contacts', '/msp/knowledge-base', '/msp/settings', '/msp/profile', '/msp/security-settings'],
    behaviorByProduct: { psa: 'allowed', algadesk: 'allowed' },
  },
  {
    group: 'msp_upgrade_boundary',
    staticPrefixes: [
      '/msp/billing',
      '/msp/projects',
      '/msp/assets',
      '/msp/schedule',
      '/msp/technician-dispatch',
      '/msp/time-entry',
      '/msp/time-sheet-approvals',
      '/msp/workflow-editor',
      '/msp/workflow-control',
      '/msp/surveys',
      '/msp/extensions',
      '/msp/reports',
      '/msp/service-requests',
    ],
    behaviorByProduct: { psa: 'allowed', algadesk: 'upgrade_boundary' },
  },
  {
    group: 'msp_internal_not_found',
    staticPrefixes: ['/msp/test'],
    behaviorByProduct: { psa: 'allowed', algadesk: 'not_found' },
  },
];

export const PORTAL_ROUTE_RULES: readonly RouteRule[] = [
  {
    group: 'portal_helpdesk',
    staticPrefixes: ['/client-portal/dashboard', '/client-portal/tickets', '/client-portal/knowledge-base', '/client-portal/profile', '/client-portal/settings'],
    behaviorByProduct: { psa: 'allowed', algadesk: 'allowed' },
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
    behaviorByProduct: { psa: 'allowed', algadesk: 'upgrade_boundary' },
  },
];

export const API_RULES: readonly ApiRule[] = [
  {
    group: 'api_helpdesk_allowed',
    staticPrefixes: [
      '/api/v1/tickets',
      '/api/v1/comments',
      '/api/v1/clients',
      '/api/v1/contacts',
      '/api/v1/boards',
      '/api/v1/statuses',
      '/api/v1/priorities',
      '/api/v1/tags',
      '/api/v1/knowledge-base',
      '/api/v1/email',
      '/api/v1/users',
      '/api/v1/teams',
    ],
    behaviorByProduct: { psa: 'allowed', algadesk: 'allowed' },
    visibleInMetadataByProduct: { psa: true, algadesk: true },
  },
  {
    group: 'api_psa_only',
    staticPrefixes: [
      '/api/v1/billing',
      '/api/v1/invoices',
      '/api/v1/projects',
      '/api/v1/assets',
      '/api/v1/time-entries',
      '/api/v1/workflows',
      '/api/v1/extensions',
      '/api/v1/surveys',
      '/api/v1/chat',
      '/api/v1/documents',
    ],
    behaviorByProduct: { psa: 'allowed', algadesk: 'denied' },
    visibleInMetadataByProduct: { psa: true, algadesk: false },
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

export function resolveProductRouteBehavior(productCode: ProductCode, pathname: string): ProductRouteBehavior {
  const rules = pathname.startsWith('/client-portal/') ? PORTAL_ROUTE_RULES : MSP_ROUTE_RULES;
  const matched = rules.find((rule) => matchesRule(pathname, rule));
  if (!matched) {
    return productCode === 'algadesk' ? 'not_found' : 'allowed';
  }

  return matched.behaviorByProduct[productCode];
}

export function resolveProductApiBehavior(productCode: ProductCode, path: string): ProductApiBehavior {
  const matched = API_RULES.find((rule) => matchesRule(path, rule));
  if (!matched) {
    return productCode === 'algadesk' ? 'denied' : 'allowed';
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

type MenuLikeItem = { href?: string; subItems?: MenuLikeItem[] };
type MenuLikeSection<T extends MenuLikeItem> = { items: T[] };

function includeByHref(productCode: ProductCode, href?: string): boolean {
  if (!href || href.startsWith('http')) return true;
  if (productCode === 'algadesk' && href.startsWith('/msp/settings?tab=')) {
    const tab = new URLSearchParams(href.split('?')[1]).get('tab');
    const allowedTabs = new Set(['general', 'users', 'teams', 'ticketing', 'knowledge-base', 'email', 'client-portal']);
    return tab ? allowedTabs.has(tab) : false;
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
