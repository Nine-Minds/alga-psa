// @vitest-environment node

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(__dirname, '../../../../..');

const referenceServices = [
  'server/src/lib/api/services/BoardService.ts',
  'server/src/lib/api/services/PriorityService.ts',
  'server/src/lib/api/services/StatusService.ts',
];

describe('reference API services tenant-scoped query contract', () => {
  it('uses BaseService tenant-scoped query helper for custom root queries', () => {
    for (const relativePath of referenceServices) {
      const source = fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');

      expect(source).toContain('this.buildTenantScopedQuery(knex, context)');
      expect(source).not.toMatch(/knex\('(boards|priorities|statuses)'\)\s*\.where\('tenant', context\.tenant\)/);
      expect(source).not.toMatch(/\.where\(\{\s*(board_id|priority_id|status_id): id,\s*tenant: context\.tenant\s*\}\)/);
    }
  });
});
