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
  tenantClient: { name: 'Example MSP', logoUrl: null },
});
