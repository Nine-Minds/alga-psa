import type { LabelViewModel } from '@alga-psa/types';

/** Representative label for designer preview. The URL is a placeholder, never a real record. */
export const buildSampleLabelViewModel = (): LabelViewModel => ({
  labelClass: 'ticket-work-tag',
  entityType: 'ticket',
  recordId: '6f1c2b1e-0b57-4a53-9d77-2f0f4d9f1a11',
  url: 'https://psa.example.com/msp/tickets/6f1c2b1e-0b57-4a53-9d77-2f0f4d9f1a11',
  identifier: 'TIC-001042',
  code128Value: 'AT-000123',
  title: 'Laptop will not power on',
  clientName: 'Emerald City Dental',
  detail: 'Diagnose power fault',
  secondaryIdentifier: 'AT-000123',
  serialSuffix: '7K2Q',
  assetSerialNumber: 'LAPTOP-7K2Q',
  ticketDescription: 'The laptop no longer powers on.\nPlease diagnose the power fault.',
  // Held-equipment lines replace the reason line when present; the preview shows the common case (none) so it
  // matches the print path, which collapses the reason when custody prints.
  custodyLocation: null,
  nextAction: null,
  // Shown only by the full-page customer worksheet; the 4 x 2 in tag templates bind none of these.
  linkedAsset: {
    assetId: 'b2d4e6f6-8a0c-4c1e-9e2g-4h6i8j8k0l2m',
    name: 'Dell Latitude 5540',
    manufacturer: 'Dell',
    model: 'Latitude 5540',
    osLine: 'Windows 11 Pro 23H2',
    cpuLine: 'Intel Core i7-1365U',
    ramLine: '16 GB',
    storageLine: 'SSD 512 GB',
  },
  // Shown only by templates that bind it (the staging box label): "Box n of m".
  sequence: { n: 3, total: 5 },
  tenantClient: { name: 'Example MSP', logoUrl: null, brandText: 'Example MSP' },
  display: { assetLine: 'Asset AT-000123', serialLine: 'S/N \u20267K2Q', sequenceLine: 'Box 3 of 5' },
});
