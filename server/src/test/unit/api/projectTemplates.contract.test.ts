import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The project-template routes are published as ApiKeyAuth endpoints, so every
 * handler must bridge the key's identity into its `withAuth` server action.
 * One unbridged handler is a 500 for every API-key caller (alga-2026-0002902).
 */
const ROUTE_FILES = [
  'route.ts',
  'categories/route.ts',
  '[templateId]/route.ts',
  '[templateId]/apply/route.ts',
  '[templateId]/duplicate/route.ts',
];

function readRoute(relative: string): string {
  return fs.readFileSync(path.resolve(__dirname, '../../../app/api/projects/templates', relative), 'utf8');
}

describe('Project template API-key contract', () => {
  it.each(ROUTE_FILES)('%s runs its template actions through the API-key bridge', (relative) => {
    const source = readRoute(relative);

    expect(source).toContain('runWithApiKeyOrSession');
    // Every exported handler must be bridged, not just the first one.
    const handlers = source.match(/export async function (GET|POST|PATCH|PUT|DELETE)\b/g) ?? [];
    expect(handlers.length).toBeGreaterThan(0);
    expect(source.match(/runWithApiKeyOrSession\(request,/g)?.length).toBe(handlers.length);
  });

  it('maps a missing identity to 401 rather than the 500 fallback', () => {
    const source = readRoute('templateRouteErrors.ts');

    expect(source).toContain("from '@alga-psa/auth'");
    expect(source).toContain('error instanceof AuthenticationError');
    expect(source).toContain("candidate?.name === 'UnauthorizedError'");
  });
});
