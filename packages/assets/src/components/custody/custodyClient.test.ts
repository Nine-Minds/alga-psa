import { describe, expect, it, vi } from 'vitest';

vi.mock('../../actions/assetCustodyActions', () => ({ listCustodyBins: vi.fn(), listCustodyLocations: vi.fn() }));
vi.mock('../../context/AssetCrossFeatureContext', () => ({ useAssetCrossFeature: () => ({}) }));
vi.mock('swr', () => ({ default: vi.fn() }));

import { custodyOutcome } from './custodyClient';

describe('custodyOutcome', () => {
  it('collapses an internal attribute path message to the generic custody key', () => {
    const outcome = custodyOutcome({ success: false, error: { message: 'attributes.rack_unit has an invalid value.' } });
    expect(outcome).toMatchObject({ ok: false, messageKey: 'msp/assets:custody.errors.generic' });
    expect((outcome as { message: string }).message).not.toContain('attributes.');
  });

  it('keeps a translated missing-field message', () => {
    const outcome = custodyOutcome({
      success: false,
      error: { message: 'Missing required asset field: Rack Unit.', messageKey: 'msp/assets:errors.asset.missingFieldNamed', messageParams: { field: 'Rack Unit' } },
    });
    expect(outcome).toMatchObject({ ok: false, messageKey: 'msp/assets:errors.asset.missingFieldNamed' });
  });
});
