/**
 * Maps a client portal pathname to a translation key (under the `client-portal` namespace).
 * Used by the layout to render a default page title in the top bar so individual
 * pages don't need to repeat their own H1. Pages can still override via
 * `useSetClientPortalHeader({ title: ... })` for dynamic titles.
 */
const ROUTE_TO_KEY: Array<{ test: (p: string) => boolean; key: string }> = [
  { test: (p) => p === '/client-portal' || p === '/client-portal/dashboard', key: 'nav.dashboard' },
  { test: (p) => p.startsWith('/client-portal/tickets'), key: 'nav.tickets' },
  { test: (p) => p.startsWith('/client-portal/request-services'), key: 'nav.requestServices' },
  { test: (p) => p.startsWith('/client-portal/projects'), key: 'nav.projects' },
  { test: (p) => p.startsWith('/client-portal/appointments'), key: 'nav.appointments' },
  { test: (p) => p.startsWith('/client-portal/devices'), key: 'nav.myDevices' },
  { test: (p) => p.startsWith('/client-portal/documents'), key: 'nav.documents' },
  { test: (p) => p.startsWith('/client-portal/knowledge-base'), key: 'nav.knowledgeBase' },
  { test: (p) => p.startsWith('/client-portal/billing'), key: 'nav.billing' },
  { test: (p) => p.startsWith('/client-portal/client-settings'), key: 'nav.clientSettings' },
  { test: (p) => p.startsWith('/client-portal/profile'), key: 'nav.profile' },
  { test: (p) => p.startsWith('/client-portal/account'), key: 'nav.account' },
];

export function resolveClientPortalTitleKey(pathname: string | null | undefined): string | null {
  if (!pathname) return null;
  for (const entry of ROUTE_TO_KEY) {
    if (entry.test(pathname)) return entry.key;
  }
  return null;
}
