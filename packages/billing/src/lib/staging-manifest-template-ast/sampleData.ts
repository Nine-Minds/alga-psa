import type { StagingManifestViewModel } from '@alga-psa/types';

/** Representative manifest for designer preview. The URL is a placeholder, never a real record. */
export const buildSampleStagingManifestViewModel = (): StagingManifestViewModel => ({
  box: {
    identifier: 'PRJ-0042-B03',
    name: 'Rack A',
    positionDisplay: '3 / 5',
    sequence: { n: 3, total: 5 },
    statusLabel: 'Sealed',
    sealedAt: '2026-10-24T15:30:00.000Z',
    sealedBy: 'Dana Reyes',
    location: 'Main warehouse, staging bay 2',
    notes: 'Fragile: switches on top.',
    taskName: 'Rack and stack',
    recordUrl: 'https://psa.example.com/msp/projects/6f1c2b1e-0b57-4a53-9d77-2f0f4d9f1a11/staging?containerId=0b57a1e2-7b41-4c1f-a0d3-1d2e3f4a5b6c',
  },
  project: { number: 'PRJ-0042', name: 'Emerald City Dental office refit', clientName: 'Emerald City Dental' },
  itemCount: 3,
  members: [
    { description: 'Managed switch 24-port', sku: 'SW-24', quantity: 1, serial: 'SN-5Q2K-77821', owner: 'MSP', taskName: 'Rack and stack' },
    { description: 'Cat6 patch cable 1 m', sku: 'CAB-C6-1', quantity: 24, serial: '', owner: 'MSP', taskName: 'Rack and stack' },
    { description: 'Front-desk printer', sku: 'AT-000123', quantity: 1, serial: '…7K2Q', owner: 'Client', taskName: '' },
  ],
  tenantClient: { name: 'Example MSP', logo_url: null },
});
