/**
 * The render model of an RMA return slip (alga-2026-0002683 C5): the `rma-return-slip` document type, the
 * paper that travels with a client device being returned to a vendor. Built by the inventory package's
 * read helper (which owns RMA data and its authorization) and rendered by billing; read-only.
 */
export interface RmaReturnSlipViewModel {
  rma: {
    number: string;
    statusLabel: string;
    /** Canonical record URL: the only content of the slip's QR code. */
    recordUrl: string;
    /** Calendar date (YYYY-MM-DD) or null. */
    returnBy: string | null;
    returnShipTo: string | null;
    vendorName: string | null;
    vendorReference: string | null;
    /** "Carrier tracking" of the outbound leg, or null. */
    outboundShipping: string | null;
    /** "Carrier tracking" of the inbound leg, or null. */
    inboundShipping: string | null;
    /** Both legs on one line when present ("Out: UPS 1Z.. / In: FedEx 99.."). */
    shippingSummary: string | null;
    ticketNumber: string | null;
    /** The date the slip was printed (YYYY-MM-DD, tenant-agnostic UTC date). */
    printedOn: string;
  };
  client: { name: string | null };
  asset: {
    name: string | null;
    serialNumber: string | null;
    tag: string | null;
    /** Serial of the vendor's replacement, when one has been recorded. */
    replacementSerialNumber: string | null;
  };
  /** Filled by the renderer from the tenant's branding. */
  tenantClient?: { name: string | null; logo_url: string | null } | null;
}
