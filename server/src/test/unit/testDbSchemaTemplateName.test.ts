import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { schemaTemplateName } from '../../../test-utils/dbConfig';

// Template databases are keyed by the content of the migration and seed
// sources, so an edited or added file must yield a new template name.
describe('schemaTemplateName', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tpl-'));
  const migrations = path.join(tmp, 'migrations');
  const seeds = path.join(tmp, 'seeds');
  fs.mkdirSync(migrations);
  fs.mkdirSync(seeds);
  fs.writeFileSync(path.join(migrations, '001_a.cjs'), 'a');
  fs.writeFileSync(path.join(seeds, '01_s.cjs'), 's');

  it('is stable for identical sources and prefixed as a test-only database', () => {
    const name = schemaTemplateName(migrations, seeds, true);
    expect(name).toBe(schemaTemplateName(migrations, seeds, true));
    expect(name).toMatch(/^test_schema_tpl_[0-9a-f]{16}$/);
  });

  it('changes when a migration is edited, added, or a seed changes', () => {
    const base = schemaTemplateName(migrations, seeds, true);
    fs.writeFileSync(path.join(migrations, '001_a.cjs'), 'a-edited');
    const edited = schemaTemplateName(migrations, seeds, true);
    fs.writeFileSync(path.join(migrations, '002_b.cjs'), 'b');
    const added = schemaTemplateName(migrations, seeds, true);
    fs.writeFileSync(path.join(seeds, '01_s.cjs'), 's2');
    const seeded = schemaTemplateName(migrations, seeds, true);
    expect(new Set([base, edited, added, seeded]).size).toBe(4);
  });

  it('ignores seeds when they are not run, and ignores __tests__ folders', () => {
    const withoutSeeds = schemaTemplateName(migrations, seeds, false);
    fs.writeFileSync(path.join(seeds, '01_s.cjs'), 's3');
    expect(schemaTemplateName(migrations, seeds, false)).toBe(withoutSeeds);
    expect(schemaTemplateName(migrations, seeds, true)).not.toBe(withoutSeeds);
    const before = schemaTemplateName(migrations, seeds, true);
    fs.mkdirSync(path.join(migrations, '__tests__'));
    fs.writeFileSync(path.join(migrations, '__tests__', 'x.test.ts'), 'x');
    expect(schemaTemplateName(migrations, seeds, true)).toBe(before);
  });
});
