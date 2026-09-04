import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (path: string) => readFileSync(resolve(__dirname, path), 'utf8');

describe('hour-block service eligibility', () => {
  it('filters the picker to hourly services', () => {
    const source = read('../src/components/hour-blocks/SellHourBlockDialog.tsx');
    expect(source).toContain("billing_method: 'hourly'");
  });

  it('authoritatively rejects non-hourly services in the action', () => {
    const source = read('../src/actions/hourBlockActions.ts');
    expect(source).toContain("service.billing_method !== 'hourly'");
    expect(source).toContain('Hour blocks can only be sold for hourly services');
  });
});
