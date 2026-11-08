import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (path: string) => readFileSync(resolve(__dirname, path), 'utf8');

describe('hour-block service eligibility', () => {
  it.each(['SellHourBlockDialog', 'GrantHourBlockDialog'])('%s filters the picker to hourly services', (dialog) => {
    const source = read(`../src/components/hour-blocks/${dialog}.tsx`);
    expect(source).toContain("billing_method: 'hourly'");
  });

  it('authoritatively rejects non-hourly services when selling and granting', () => {
    const source = read('../src/actions/hourBlockActions.ts');
    expect(source.match(/service\.billing_method !== 'hourly'/g)).toHaveLength(2);
    expect(source).toContain('Hour blocks can only be sold for hourly services');
    expect(source).toContain('Hour blocks can only be granted for hourly services');
  });
});
