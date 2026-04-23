import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('CE authorization bundle management placeholder', () => {
  it('shows upgrade guidance while explicitly preserving builtin authorization behavior', () => {
    const source = fs.readFileSync(
      path.resolve(process.cwd(), '../packages/ee/src/components/settings/policy/PolicyManagement.tsx'),
      'utf8'
    );

    expect(source).toContain('Enterprise Premium');
    expect(source).toContain('configure narrowing bundles for roles, teams, users, and API keys');
    expect(source).toContain('Built-in authorization protections remain active');
  });
});
