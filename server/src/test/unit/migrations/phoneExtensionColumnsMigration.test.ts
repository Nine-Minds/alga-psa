import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(__dirname, '../../../../..');
const migration = fs.readFileSync(
  path.join(repoRoot, 'server', 'migrations', '20260818120000_add_phone_extension_columns.cjs'),
  'utf8',
);

describe('phone extension columns migration', () => {
  it('requires a separator before every packed extension marker', () => {
    expect(migration).toContain("[[:space:],;]+ext(ension)?\\\\.?");
    expect(migration).not.toContain("[[:space:],;]*ext(ension)?\\\\.?");
  });

  it('only migrates digit-only extensions up to ten digits', () => {
    expect(migration).toContain('[0-9]{1,10}');
  });
});
