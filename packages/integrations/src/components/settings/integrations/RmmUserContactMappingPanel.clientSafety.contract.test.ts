import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * FR-D8, the browser half.
 *
 * `RmmUserContactMappingPanel` is a client component, and it value-imported
 * the People modes from `@alga-psa/shared/rmm/userMatching` — a module that
 * needs `@alga-psa/db` to find a contact. That drags knex → pg → `fs` into the
 * browser graph and the whole of Settings → Integrations stopped compiling
 * (HTTP 500 on /msp/settings/integrations). The modes now live in an
 * import-free sibling that both sides can read.
 */
const panel = fs.readFileSync(path.resolve(__dirname, './RmmUserContactMappingPanel.tsx'), 'utf8');
const sharedRoot = path.resolve(__dirname, '../../../../../../shared');
const modes = fs.readFileSync(path.join(sharedRoot, 'rmm/contactAssignmentModes.ts'), 'utf8');
const userMatching = fs.readFileSync(path.join(sharedRoot, 'rmm/userMatching.ts'), 'utf8');

describe('the mapping panel stays out of the database graph', () => {
  it('reads the People modes from the import-free module', () => {
    expect(panel).toContain("from '@alga-psa/shared/rmm/contactAssignmentModes'");
    expect(panel).not.toContain("from '@alga-psa/shared/rmm/userMatching'");
  });

  it('value-imports no db-coupled shared module', () => {
    const valueImports = [...panel.matchAll(/^import\s+(?!type\s)[^;]*?from\s+'(@alga-psa\/shared\/[^']+)'/gm)].map(
      (match) => match[1]
    );
    expect(valueImports).toEqual(['@alga-psa/shared/rmm/contactAssignmentModes']);
  });

  it('the modes module imports nothing at all', () => {
    expect(modes).not.toMatch(/^import\s/m);
    expect(modes).toContain("export const RMM_CONTACT_ASSIGNMENT_MODES");
  });

  it('userMatching still re-exports them for its server callers', () => {
    expect(userMatching).toContain("} from './contactAssignmentModes';");
    expect(userMatching).toContain('isRmmContactAssignmentMode');
  });
});
