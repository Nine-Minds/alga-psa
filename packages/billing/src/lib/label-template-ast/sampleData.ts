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
  // Held-equipment lines replace the reason line when present; the preview shows the common case (none) so it
  // matches the print path, which collapses the reason when custody prints.
  custodyLocation: null,
  nextAction: null,
  // Shown only by templates that bind it (the staging box label): "Box n of m".
  sequence: { n: 3, total: 5 },
  tenantClient: { name: 'Example MSP', logoUrl: null, brandText: 'Example MSP' },
  display: { assetLine: 'Asset AT-000123', serialLine: 'S/N \u20267K2Q', sequenceLine: 'Box 3 of 5' },
});
