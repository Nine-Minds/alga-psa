import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// Every MSP surface that mounts <QuickAddTicket> must hand it the multi-asset picker, otherwise the
// dialog's Assets section silently degrades to "can be linked after it is created" (e.g. when opened
// from an asset page). The tickets package cannot import assets, so the wiring is by composition.
const SURFACES = [
  'assets/MspAssetCrossFeatureProvider.tsx',
  'clients/MspClientCrossFeatureProvider.tsx',
  'projects/useTicketIntegrationValue.tsx',
  'workflows/MspActivityCrossFeatureProvider.tsx',
];

describe('Quick Add asset picker wiring', () => {
  it.each(SURFACES)('%s passes renderAssetPicker to QuickAddTicket', (relative) => {
    const text = fs.readFileSync(path.resolve(__dirname, '../..', relative), 'utf8');
    expect(text).toContain("import { renderQuickAddAssetPicker } from '../tickets/renderQuickAddAssetPicker';");
    expect(text).toMatch(/<QuickAddTicket[\s\S]*?renderAssetPicker=\{renderQuickAddAssetPicker\}[\s\S]*?\/>/);
  });
});
