/* @vitest-environment node */

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

function read(relativePath: string): string {
  return fs.readFileSync(path.resolve(__dirname, relativePath), 'utf8');
}

describe('CustomTabs source contract', () => {
  it('requires an id field on TabContent and uses ids for grouped auto-expand matching', () => {
    const source = read('./CustomTabs.tsx');

    expect(source).toContain('id: string;');
    expect(source).toContain('tab.id === defaultTab');
    expect(source).toContain('tab.id === value');
    expect(source).toContain('key={tab.id}');
    expect(source).toContain('value={tab.id}');
    expect(source).toContain('return allTabs[0].id;');
    expect(source).not.toContain('tab.label === defaultTab');
    expect(source).not.toContain('tab.label === value');
  });
});
