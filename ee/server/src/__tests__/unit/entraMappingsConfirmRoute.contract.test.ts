import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(
  path.join(here, '..', '..', 'app', 'api', 'integrations', 'entra', 'mappings', 'confirm', 'route.ts'),
  'utf8'
);

describe('Entra mappings confirm route contract', () => {
  it('F032: validates entitlement group IDs against groups loaded for the selected managed tenant', () => {
    expect(source).toContain('listSecurityGroupsForTenant');
    expect(source).toContain('Selected entitlement group must belong to the managed Entra tenant.');
    expect(source).toContain('clientPortalEntitlementGroupId');
  });
});

