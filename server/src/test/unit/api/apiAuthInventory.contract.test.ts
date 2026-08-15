import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Inventory contract over the copied-auth controllers and direct routes that
 * load a user from an API key. Any new `findUserByIdForApi` context assignment
 * must be guarded by `assertInternalApiUser` before `req.context` is assigned,
 * so a permissively mocked or regressed validator can never admit a client user.
 *
 * This is an inventory test only; the behavioral validator/context suites are
 * the primary proof.
 */

const CONTROLLER_DIR = resolve(__dirname, '../../../lib/api/controllers');
const CONTROLLERS = [
  'ApiContactController.ts',
  'ApiProjectController.ts',
  'ApiQuickBooksController.ts',
  'ApiTeamController.ts',
  'ApiTicketController.ts',
  'ApiTimeEntryController.ts',
  'ApiTimeSheetController.ts',
  'ApiUserController.ts',
  'ApiWebhookController.ts',
];

const ROUTE_FILES = [
  resolve(__dirname, '../../../app/api/documents/[documentId]/content/route.ts'),
  resolve(__dirname, '../../../app/api/documents/[documentId]/download/route.ts'),
  resolve(__dirname, '../../../app/api/documents/view/[fileId]/route.ts'),
];

describe('copied-auth inventory: every API-user load is guarded by assertInternalApiUser', () => {
  it.each(CONTROLLERS)('%s guards every findUserByIdForApi call', (file) => {
    const source = readFileSync(resolve(CONTROLLER_DIR, file), 'utf8');

    const loadSites = source.split('const user = await findUserByIdForApi(').length - 1;
    expect(loadSites, `${file} should contain findUserByIdForApi calls`).toBeGreaterThan(0);

    // Count of the guarded pattern immediately following each load.
    const guarded = source
      .split('const user = await findUserByIdForApi(')
      .slice(1)
      .filter((rest) => rest.includes('assertInternalApiUser(user);')).length;

    expect(guarded).toBe(loadSites);

    // No unguarded null-check fallback may replace the assertion.
    const rawNullChecks = source.match(/const user = await findUserByIdForApi\([\s\S]{0,200}?if \(!user\)/g) ?? [];
    expect(rawNullChecks, `${file} should have no raw if (!user) guards after user load`).toHaveLength(0);
  });

  it('guards API-key user loading in the document routes', () => {
    for (const file of ROUTE_FILES) {
      const source = readFileSync(file, 'utf8');
      if (source.includes('findUserByIdForApi(')) {
        expect(source).toContain('assertInternalApiUser');
      }
    }
  });

  it('base controller and shared context builder both call assertInternalApiUser', () => {
    const base = readFileSync(resolve(CONTROLLER_DIR, 'ApiBaseController.ts'), 'utf8');
    expect(base).toContain('assertInternalApiUser(user);');

    const middleware = readFileSync(
      resolve(__dirname, '../../../lib/api/middleware/apiMiddleware.ts'),
      'utf8'
    );
    expect(middleware).toContain('assertInternalApiUser(user);');
    expect(middleware).toContain('export function assertInternalApiUser');
  });
});
