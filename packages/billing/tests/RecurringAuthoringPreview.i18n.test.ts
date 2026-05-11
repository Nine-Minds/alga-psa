// @vitest-environment node

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

function read(relativePath: string): string {
  return fs.readFileSync(path.resolve(__dirname, relativePath), 'utf8');
}

function readJson<T>(relativePath: string): T {
  return JSON.parse(read(relativePath)) as T;
}

function getLeaf(record: Record<string, unknown>, dottedPath: string): unknown {
  return dottedPath.split('.').reduce<unknown>((value, key) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return undefined;
    }

    return (value as Record<string, unknown>)[key];
  }, record);
}

describe('RecurringAuthoringPreview i18n wiring', () => {
  it('keeps the unsupported contract-cadence summary on a locale-addressable key', () => {
    const source = read('../src/components/billing-dashboard/contracts/recurringAuthoringPreview.ts');
    const en = readJson<Record<string, unknown>>(
      '../../../server/public/locales/en/msp/contracts.json',
    );
    const de = readJson<Record<string, unknown>>(
      '../../../server/public/locales/de/msp/contracts.json',
    );

    expect(source).toContain('recurringPreview.materializedPeriods.summary.contractUnsupportedFrequency');
    expect(getLeaf(en, 'recurringPreview.materializedPeriods.summary.contractUnsupportedFrequency')).toBeDefined();
    expect(getLeaf(de, 'recurringPreview.materializedPeriods.summary.contractUnsupportedFrequency')).toBeDefined();
  });
});
