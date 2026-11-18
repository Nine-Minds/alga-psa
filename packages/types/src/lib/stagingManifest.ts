/**
 * The render model of a project staging box manifest (alga-2026-0002683 C6): the `staging-manifest`
 * document type. Built by the projects package (which owns staging data and its authorization) and
 * rendered by billing's registered-document renderer; neither imports the other.
 *
 * Contents are what a technician checks at the site: every member line with its quantity and, for MSP
 * stock units, the full serial number (an identifier, not a credential). Client assets carry their
 * asset tag and only a serial suffix.
 */
export interface StagingManifestMember {
  /** Product name, client asset name, or the client item's description. */
  description: string;
  /** Product SKU, or the client asset's tag. */
  sku: string;
  quantity: number;
  /** Full serial (MSP stock unit), "…suffix" (client asset), or empty. */
  serial: string;
  /** Localized "MSP" / "Client". */
  owner: string;
  taskName: string;
}

export interface StagingManifestViewModel {
  box: {
    identifier: string;
    name: string | null;
    /** "n / m": the box's rank among the project's boxes when the manifest was printed. */
    positionDisplay: string;
    sequence: { n: number; total: number };
    /** Localized open / sealed. */
    statusLabel: string;
    sealedAt: string | null;
    sealedBy: string | null;
    location: string | null;
    notes: string | null;
    taskName: string | null;
    /** The box's canonical record URL: the only content of the QR code. */
    recordUrl: string;
  };
  project: { number: string; name: string; clientName: string | null };
  itemCount: number;
  members: StagingManifestMember[];
  /** Filled by the renderer from the tenant's branding. */
  tenantClient?: { name: string | null; logo_url: string | null } | null;
}
