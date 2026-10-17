import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const source = fs.readFileSync(
  path.resolve(__dirname, './ClientDevicesPage.tsx'),
  'utf8',
);

describe('client portal device list status contract (FR-B5)', () => {
  it('offers the statuses the client\'s devices are in, not a hardcoded pair', () => {
    // The filter used to offer Active/Inactive only, so a device the MSP put
    // in a tenant status could not be filtered for at all.
    expect(source).toContain('...statusSummaries.map((summary) => ({');
    expect(source).toContain('value: summary.slug');
    expect(source).not.toContain("t('devices.status.active'");
    expect(source).not.toContain("t('devices.status.inactive'");
    expect(source).not.toContain("'all' | 'active' | 'inactive'");
  });

  it('reads the banner from the deployable kind through the shared tally', () => {
    expect(source).toContain('tallyPortalDeviceStatuses(statusSummaries)');
    expect(source).toContain("t('devices.statusAttentionTitle'");
    expect(source).toContain("t('devices.statusAttentionBody'");
    expect(source).not.toContain("t('devices.statusWarnTitle'");
    expect(source).not.toContain('response?.active');
    expect(source).not.toContain('response?.inactive');
  });

  it('names the statuses standing in the way of an all-active fleet', () => {
    expect(source).toContain('...attention.map((summary) =>');
    expect(source).toContain("t('devices.statusCount'");
  });

  it('gives the row, the filter and the details dialog one reading of a slug', () => {
    expect(source).toContain('const statusLabel = (slug: string | null | undefined) =>');
    expect(source).toContain('portalAssetStatusVariant(value, statusBySlug.get(value)?.kind)');
    expect(source).toContain('statusLabel={statusLabel(selectedAsset.status)}');
    expect(source).toContain('statusKind={statusBySlug.get(selectedAsset.status)?.kind}');
  });
});
