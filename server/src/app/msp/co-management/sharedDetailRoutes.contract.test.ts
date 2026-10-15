import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { normalizeAppPath } from 'next/dist/shared/lib/router/utils/app-paths.js';
import { getRouteRegex } from 'next/dist/shared/lib/router/utils/route-regex.js';
import { getSortedRoutes } from 'next/dist/shared/lib/router/utils/sorted-routes.js';

/**
 * Resolution, not grep.
 *
 * Human review blocker 6 reported the shared project-task detail route
 * rendering the root "404 - Page Not Found" on a URL the queue itself had just
 * linked to. The page file was present and byte-identical to its working
 * siblings, so every string-matching check passed while the route was
 * unreachable. What no existing test covered was the only question that
 * mattered: does the URL the product emits actually resolve to a page?
 *
 * So this builds the app route table the way Next does -- enumerate page files,
 * normalise slots and route groups away with Next's own `normalizeAppPath`,
 * order them with Next's own `getSortedRoutes`, match with Next's own
 * `getRouteRegex` -- and asks that question of the concrete link shapes the
 * co-managed surfaces emit. Deleting, renaming or re-nesting any of those route
 * folders fails this test; reformatting their contents does not.
 */

const appDir = path.resolve(__dirname, '../../..', 'app');
const repoRoot = path.resolve(__dirname, '../../../../..');

const PAGE_FILE = /^page\.(tsx|ts|jsx|js)$/;

interface AppPage {
  /** Route path as Next serves it, e.g. `/msp/co-management/tasks/[taskId]`. */
  route: string;
  /** Repo-relative page file, for failure messages. */
  file: string;
  /** Parallel-slot directory chain, e.g. ['@modal']; empty for `children`. */
  slots: string[];
}

function collectPages(dir: string, segments: string[] = []): AppPage[] {
  const pages: AppPage[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      // `_components`-style private folders never produce routes.
      if (entry.name.startsWith('_')) continue;
      pages.push(...collectPages(path.join(dir, entry.name), [...segments, entry.name]));
    } else if (PAGE_FILE.test(entry.name)) {
      const full = path.join(dir, entry.name);
      pages.push({
        route: normalizeAppPath(`/${segments.join('/')}`),
        file: path.relative(repoRoot, full),
        slots: segments.filter((segment) => segment.startsWith('@')),
      });
    }
  }
  return pages;
}

const allPages = collectPages(appDir);

/** Pages reachable as the `children` slot -- the actual page of a URL. */
const childPages = allPages.filter((page) => page.slots.length === 0);

function makeResolver(pages: AppPage[]) {
  const byRoute = new Map<string, AppPage[]>();
  for (const page of pages) {
    byRoute.set(page.route, [...(byRoute.get(page.route) ?? []), page]);
  }
  // getSortedRoutes is what Next uses to give static segments precedence over
  // dynamic ones, and dynamic over catch-all, so first-match-wins is faithful.
  const ordered = getSortedRoutes([...byRoute.keys()]);

  return function resolve(url: string): { page: AppPage; params: Record<string, string | string[]> } | null {
    const pathname = url.split('?')[0];
    for (const route of ordered) {
      const { re, groups } = getRouteRegex(route);
      const match = re.exec(pathname);
      if (!match) continue;
      const params: Record<string, string | string[]> = {};
      for (const [name, group] of Object.entries(groups)) {
        const raw = match[group.pos];
        if (raw === undefined) continue;
        params[name] = group.repeat ? raw.split('/') : raw;
      }
      return { page: byRoute.get(route)![0], params };
    }
    return null;
  };
}

const resolveChild = makeResolver(childPages);

// The ids the human-review guide's failing URL carries, kept verbatim so the
// exact reported URL is the thing under test.
const CUSTOMER_TENANT = '51ac6952-6d6f-4600-aace-b71a9b2a5e73';
const RELATIONSHIP_ID = '73950eda-1f0e-4196-8480-2ca096c9685d';
const TASK_ID = 'd65d3c58-17f5-57f2-abc7-70bea5b2447c';

describe('co-managed shared detail route resolution', () => {
  it('resolves the reported shared project-task URL to the shared task page', () => {
    const url = `/msp/co-management/tasks/${CUSTOMER_TENANT}/${RELATIONSHIP_ID}/${TASK_ID}`;
    const resolved = resolveChild(url);

    expect(resolved, `${url} resolved to no page at all`).not.toBeNull();
    expect(resolved!.page.file).toBe(
      'server/src/app/msp/co-management/tasks/[customerTenant]/[relationshipId]/[taskId]/page.tsx',
    );
    expect(resolved!.params).toEqual({
      customerTenant: CUSTOMER_TENANT,
      relationshipId: RELATIONSHIP_ID,
      taskId: TASK_ID,
    });
  });

  it('resolves every tenant-qualified shared detail link the product emits', () => {
    // The three shared surfaces are one shape; blocker 6 was only *reported*
    // against tasks, and hard-reloading the siblings was never part of the
    // report. Cover all three so a regression cannot hide in the two nobody
    // clicked.
    const cases = [
      {
        url: `/msp/co-management/tasks/${CUSTOMER_TENANT}/${RELATIONSHIP_ID}/${TASK_ID}`,
        file: 'server/src/app/msp/co-management/tasks/[customerTenant]/[relationshipId]/[taskId]/page.tsx',
        idParam: 'taskId',
      },
      {
        url: `/msp/co-management/tickets/${CUSTOMER_TENANT}/${RELATIONSHIP_ID}/9292ffb5-2535-5878-b24c-c83f7a7ae4df`,
        file: 'server/src/app/msp/co-management/tickets/[customerTenant]/[relationshipId]/[ticketId]/page.tsx',
        idParam: 'ticketId',
      },
      {
        url: `/msp/co-management/projects/${CUSTOMER_TENANT}/${RELATIONSHIP_ID}/6d8f2b1a-0000-4000-8000-00000000abcd`,
        file: 'server/src/app/msp/co-management/projects/[customerTenant]/[relationshipId]/[projectId]/page.tsx',
        idParam: 'projectId',
      },
    ] as const;

    for (const { url, file, idParam } of cases) {
      const resolved = resolveChild(url);
      expect(resolved, `${url} resolved to no page at all`).not.toBeNull();
      expect(resolved!.page.file, url).toBe(file);
      expect(Object.keys(resolved!.params).sort(), url).toEqual(
        ['customerTenant', idParam, 'relationshipId'].sort(),
      );
    }
  });

  it('resolves the sponsor-native project task link the queue falls back to', () => {
    // CoManagedProjectTaskQueue links tenant-qualified when a relationship is
    // known and to the sponsor's own project task otherwise; both arms have to
    // land somewhere.
    const resolved = resolveChild('/msp/projects/11111111-1111-1111-1111-111111111111/tasks/22222222-2222-2222-2222-222222222222');

    expect(resolved).not.toBeNull();
    expect(resolved!.page.file).toBe('server/src/app/msp/projects/[id]/tasks/[taskId]/page.tsx');
  });

  it('resolves every static page under /msp back to itself', () => {
    // The blocker presented as a whole band of /msp routes rendering not-found
    // while their files sat on disk. A per-route assertion would have named
    // only the route someone happened to click, so assert the table as a whole:
    // a static route that cannot resolve to its own URL is unreachable.
    const staticMspPages = childPages.filter(
      (page) => page.route.startsWith('/msp/') && !page.route.includes('['),
    );

    expect(staticMspPages.length).toBeGreaterThan(20);

    const unreachable = staticMspPages.filter((page) => resolveChild(page.route)?.page.file !== page.file);
    expect(unreachable.map((page) => page.route)).toEqual([]);
  });
});

describe('the /msp parallel modal slot never withholds a match', () => {
  // An App Router page 404s when a sibling parallel slot matches nothing, so
  // the @modal slot has to answer for every /msp URL, not just the ones that
  // open a modal. `default.tsx` covers hard loads; `[...catchAll]` covers soft
  // navigation, where an unmatched slot keeps its previous content instead.
  const modalSlotDir = path.join(appDir, 'msp', '@modal');

  const modalPages = allPages.filter((page) =>
    page.file.startsWith('server/src/app/msp/@modal/'),
  );
  const resolveModal = makeResolver(modalPages);

  it('keeps a default and a catch-all in the slot', () => {
    expect(fs.existsSync(path.join(modalSlotDir, 'default.tsx'))).toBe(true);
    expect(
      modalPages.some((page) => page.route === '/msp/[...catchAll]'),
      'the @modal slot has no catch-all, so soft navigation away from a modal keeps the stale dialog',
    ).toBe(true);
  });

  it('matches the deep co-managed detail URLs as well as the shallow ones', () => {
    const urls = [
      '/msp/tickets',
      '/msp/tickets/9292ffb5-2535-5878-b24c-c83f7a7ae4df',
      '/msp/co-management/tasks',
      `/msp/co-management/tasks/${CUSTOMER_TENANT}/${RELATIONSHIP_ID}/${TASK_ID}`,
      `/msp/co-management/tickets/${CUSTOMER_TENANT}/${RELATIONSHIP_ID}/9292ffb5-2535-5878-b24c-c83f7a7ae4df`,
      `/msp/co-management/projects/${CUSTOMER_TENANT}/${RELATIONSHIP_ID}/6d8f2b1a-0000-4000-8000-00000000abcd`,
    ];

    for (const url of urls) {
      expect(resolveModal(url), `@modal matched nothing for ${url}`).not.toBeNull();
    }
  });
});
