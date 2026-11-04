import type { RmaReturnSlipViewModel } from '@alga-psa/types';

/** Representative return slip for designer preview. The URL is a placeholder, never a real record. */
export const buildSampleRmaReturnSlipViewModel = (): RmaReturnSlipViewModel => ({
  rma: {
    number: 'RMA-00007',
    statusLabel: 'Returned',
    recordUrl: 'https://psa.example.com/msp/inventory/rma?rmaId=6f1c2b1e-0b57-4a53-9d77-2f0f4d9f1a11',
    returnBy: '2026-11-15',
    returnShipTo: 'Contoso Distribution, RMA Dept, 100 Vendor Way, Austin TX 78701',
    vendorName: 'Contoso Distribution',
    vendorReference: 'CD-884213',
    outboundShipping: 'UPS 1Z999AA10123456784',
    inboundShipping: null,
    shippingSummary: 'UPS 1Z999AA10123456784',
    ticketNumber: 'TIC-001042',
    printedOn: '2026-10-25',
  },
  client: { name: 'Emerald City Dental' },
  asset: { name: 'Front desk laptop', serialNumber: 'SN-48QX7K2Q', tag: 'AT-000123', replacementSerialNumber: null },
  tenantClient: { name: 'Example MSP', logo_url: null },
});
