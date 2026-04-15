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

describe('BucketOverlayFields i18n wiring contract', () => {
  it('T040: included/overage/rollover labels and unit strings use translated keys', () => {
    const source = read('../../src/components/billing-dashboard/contracts/BucketOverlayFields.tsx');
    const en = readJson<Record<string, unknown>>(
      '../../../../server/public/locales/en/msp/contracts.json'
    );

    expect(source).toContain("const { t } = useTranslation('msp/contracts');");

    const keyChecks = [
      'bucketOverlay.includedLabel',
      'bucketOverlay.includedTooltip',
      'bucketOverlay.includedPlaceholderHours',
      'bucketOverlay.includedPlaceholderUnits',
      'bucketOverlay.overageRateLabel',
      'bucketOverlay.overageRateTooltip',
      'bucketOverlay.rolloverLabel',
      'bucketOverlay.rolloverDescription',
      'bucketOverlay.units.hour',
      'bucketOverlay.units.hours',
      'bucketOverlay.units.units',
    ];

    for (const key of keyChecks) {
      expect(source).toContain(`t('${key}'`);
      expect(getLeaf(en, key)).toBeDefined();
    }
  });
});
