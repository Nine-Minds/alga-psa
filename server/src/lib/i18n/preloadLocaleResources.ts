import 'server-only';
import { readFile } from 'fs/promises';
import path from 'path';
import { headers } from 'next/headers';
import { getNamespacesForRoute } from '@alga-psa/core/i18n/config';
import type { PreloadedNamespaceResources } from '@alga-psa/ui/lib/i18n/client';

/**
 * Read the JSON translation files for the current route's namespaces off disk
 * so they can be embedded in the initial HTML. This replaces N per-namespace
 * `/locales/{lng}/{ns}.json` HTTP fetches (i18next-http-backend) with zero
 * network round-trips — the client seeds i18next from these resources.
 *
 * Namespaces are resolved from the middleware-stamped `x-pathname` header, so
 * the shared MSP layout preloads exactly what the concrete page needs.
 */
export async function preloadLocaleResources(
  locale: string,
): Promise<PreloadedNamespaceResources> {
  let pathname = '/';
  try {
    const headerList = await headers();
    pathname = headerList.get('x-pathname') || headerList.get('x-invoke-path') || '/';
  } catch {
    // headers() unavailable (static context) — fall back to base namespaces.
  }

  // 'common' + the route's namespaces, plus cross-cutting namespaces that the
  // shared MSP shell (quick-create, drawers, pickers, shortcuts) pulls lazily
  // on essentially every page — preloading them here avoids a per-namespace
  // HTTP fetch after hydration.
  const SHELL_NAMESPACES = [
    'common',
    'msp/core',
    'msp/clients',
    'msp/assets',
    'msp/contacts',
    'msp/time-entry',
    'msp/keyboard-shortcuts',
    'msp/surveys',
    'features/projects',
    'features/documents',
  ];
  const namespaces = Array.from(new Set([...SHELL_NAMESPACES, ...getNamespacesForRoute(pathname)]));
  const localesDir = path.join(process.cwd(), 'public', 'locales', locale);

  const entries = await Promise.all(
    namespaces.map(async (namespace) => {
      try {
        const file = path.join(localesDir, `${namespace}.json`);
        const raw = await readFile(file, 'utf8');
        return [namespace, JSON.parse(raw) as Record<string, unknown>] as const;
      } catch {
        // Missing/unreadable namespace file: let the client backend fetch it.
        return null;
      }
    }),
  );

  const resources: PreloadedNamespaceResources = {};
  for (const entry of entries) {
    if (entry) resources[entry[0]] = entry[1];
  }
  return resources;
}
