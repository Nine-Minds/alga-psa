import type { TemplateAst } from '@alga-psa/types';

type SlipBindings = NonNullable<TemplateAst['bindings']>;
type SlipValueBindings = NonNullable<SlipBindings['values']>;

/**
 * Bindings of the `rma-return-slip` document (alga-2026-0002683 C5): the paper that travels with a client
 * device returned to a vendor. Paths resolve against `RmaReturnSlipViewModel` (`@alga-psa/types`), built by
 * the inventory package's RMA print helper. `recordUrl` is the RMA's canonical record URL (the QR content).
 */
export const RMA_RETURN_SLIP_VALUE_BINDINGS: SlipValueBindings = {
  rmaNumber: { id: 'rmaNumber', kind: 'value', path: 'rma.number' },
  rmaStatus: { id: 'rmaStatus', kind: 'value', path: 'rma.statusLabel', fallback: '' },
  recordUrl: { id: 'recordUrl', kind: 'value', path: 'rma.recordUrl' },
  returnBy: { id: 'returnBy', kind: 'value', path: 'rma.returnBy', fallback: '' },
  returnShipTo: { id: 'returnShipTo', kind: 'value', path: 'rma.returnShipTo', fallback: '' },
  vendorName: { id: 'vendorName', kind: 'value', path: 'rma.vendorName', fallback: '' },
  vendorReference: { id: 'vendorReference', kind: 'value', path: 'rma.vendorReference', fallback: '' },
  outboundShipping: { id: 'outboundShipping', kind: 'value', path: 'rma.outboundShipping', fallback: '' },
  inboundShipping: { id: 'inboundShipping', kind: 'value', path: 'rma.inboundShipping', fallback: '' },
  shippingSummary: { id: 'shippingSummary', kind: 'value', path: 'rma.shippingSummary', fallback: '' },
  ticketNumber: { id: 'ticketNumber', kind: 'value', path: 'rma.ticketNumber', fallback: '' },
  printedOn: { id: 'printedOn', kind: 'value', path: 'rma.printedOn', fallback: '' },
  clientName: { id: 'clientName', kind: 'value', path: 'client.name', fallback: '' },
  assetName: { id: 'assetName', kind: 'value', path: 'asset.name', fallback: '' },
  assetSerialNumber: { id: 'assetSerialNumber', kind: 'value', path: 'asset.serialNumber', fallback: '' },
  assetTag: { id: 'assetTag', kind: 'value', path: 'asset.tag', fallback: '' },
  replacementSerialNumber: { id: 'replacementSerialNumber', kind: 'value', path: 'asset.replacementSerialNumber', fallback: '' },
  tenantName: { id: 'tenantName', kind: 'value', path: 'tenantClient.name', fallback: '' },
  tenantLogo: { id: 'tenantLogo', kind: 'value', path: 'tenantClient.logo_url' },
};

export const buildRmaReturnSlipTemplateBindings = (): SlipBindings => ({
  values: { ...RMA_RETURN_SLIP_VALUE_BINDINGS },
  collections: {},
});
