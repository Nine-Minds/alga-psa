import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import {
  AMP_ENTITY_TABLES,
  AMP_LIMITS,
  type AmpAssetRecord,
  type AmpContactRecord,
  type AmpLocationRecord,
  type AmpManifest,
  type AmpOrganizationRecord,
  type AmpPackageDiagnosticRecord,
  type AmpPackageRows,
  type AmpTicketCommentRecord,
  type AmpTicketRecord,
} from '@alga-psa/migration-spec';
import { validateAmpPackage } from '@alga-psa/migration-sdk';
import { writeAlgaExport } from '@alga-psa/migration-connectors';

const EXPORT_BATCH_SIZE = 5000;

export interface AmpExportResult {
  buffer: Buffer;
  manifest: AmpManifest;
  rowCounts: Record<string, number>;
}

/**
 * Alga → AMP export for the v1 entities. The export is a conforming AMP
 * producer: identifiers are namespaced Alga ids (never interpreted as Alga
 * ids on re-import — the identity ledger treats them as opaque source keys),
 * reference data travels as names, and the output validates against the same
 * SDK validator every other producer uses.
 */
export class AmpExportService {
  constructor(
    private readonly knex: Knex,
    private readonly tenant: string
  ) {}

  async exportTenant(): Promise<AmpExportResult> {
    const namespace = `alga:${this.tenant}`;
    const db = tenantDb(this.knex, this.tenant);

    const [organizations, locations, contacts, tickets, ticketComments, assets] = await Promise.all([
      this.exportOrganizations(db, namespace),
      this.exportLocations(db, namespace),
      this.exportContacts(db, namespace),
      this.exportTickets(db, namespace),
      this.exportTicketComments(db, namespace),
      this.exportAssets(db, namespace),
    ]);

    // Children whose parent rows were filtered (e.g. a comment on a ticket
    // outside the export) would break package referential integrity; drop
    // them explicitly rather than emit an invalid package.
    const ticketIds = new Set(tickets.map((ticket) => ticket.package_record_id));
    const contactIds = new Set(contacts.map((contact) => contact.package_record_id));
    const organizationIds = new Set(organizations.map((org) => org.package_record_id));
    const locationIds = new Set(locations.map((location) => location.package_record_id));

    const rows: AmpPackageRows = {
      organizations,
      locations: locations.filter((location) =>
        organizationIds.has(location.organization_package_record_id)
      ),
      contacts: contacts.map((contact) => ({
        ...contact,
        organization_package_record_id:
          contact.organization_package_record_id &&
          organizationIds.has(contact.organization_package_record_id)
            ? contact.organization_package_record_id
            : null,
      })),
      tickets: tickets.map((ticket) => ({
        ...ticket,
        organization_package_record_id:
          ticket.organization_package_record_id &&
          organizationIds.has(ticket.organization_package_record_id)
            ? ticket.organization_package_record_id
            : null,
        requester_package_record_id:
          ticket.requester_package_record_id && contactIds.has(ticket.requester_package_record_id)
            ? ticket.requester_package_record_id
            : null,
        location_package_record_id:
          ticket.location_package_record_id && locationIds.has(ticket.location_package_record_id)
            ? ticket.location_package_record_id
            : null,
      })),
      ticket_comments: ticketComments
        .filter((comment) => ticketIds.has(comment.ticket_package_record_id))
        .map((comment) => ({
          ...comment,
          author_package_record_id:
            comment.author_package_record_id && contactIds.has(comment.author_package_record_id)
              ? comment.author_package_record_id
              : null,
        })),
      assets: assets.map((asset) => ({
        ...asset,
        organization_package_record_id:
          asset.organization_package_record_id &&
          organizationIds.has(asset.organization_package_record_id)
            ? asset.organization_package_record_id
            : null,
        location_package_record_id:
          asset.location_package_record_id && locationIds.has(asset.location_package_record_id)
            ? asset.location_package_record_id
            : null,
      })),
    };

    // Producer obligation: emitted values must respect the AMP limits. Live
    // data can exceed them (e.g. a pasted log in a comment); truncate to the
    // limit and record the truncation as a package diagnostic.
    const diagnostics = sanitizeTextLimits(rows);
    if (diagnostics.length > 0) {
      rows.package_diagnostics = [...(rows.package_diagnostics ?? []), ...diagnostics];
    }

    const directory = await mkdtemp(join(tmpdir(), 'amp-export-'));
    const packagePath = join(directory, 'export.amp');
    try {
      const manifest = writeAlgaExport(packagePath, rows, this.tenant);

      const validation = validateAmpPackage(packagePath);
      if (!validation.valid) {
        const summary = validation.diagnostics
          .slice(0, 5)
          .map((diagnostic) => `${diagnostic.code}: ${diagnostic.message}`)
          .join(' | ');
        throw new Error(`Alga export produced a non-conforming package: ${summary}`);
      }

      const buffer = await readFile(packagePath);
      const rowCounts = Object.fromEntries(
        Object.entries(rows).map(([table, tableRows]) => [table, tableRows?.length ?? 0])
      );
      return { buffer, manifest, rowCounts };
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }

  private async exportOrganizations(
    db: ReturnType<typeof tenantDb>,
    namespace: string
  ): Promise<AmpOrganizationRecord[]> {
    const rows = await db
      .table('clients')
      .select('client_id', 'client_name', 'url', 'properties', 'created_at', 'updated_at')
      .orderBy('client_id')
      .limit(EXPORT_BATCH_SIZE * 100);
    return rows.map((row) => ({
      package_record_id: `org-${row.client_id}`,
      source_record_id: row.client_id,
      external_identifier_namespace: namespace,
      name: row.client_name,
      website: row.url || null,
      phone: (row.properties as { phone?: string } | null)?.phone ?? null,
      created_at: toRfc3339(row.created_at) ?? toRfc3339(new Date())!,
      updated_at: toRfc3339(row.updated_at),
    }));
  }

  private async exportLocations(
    db: ReturnType<typeof tenantDb>,
    namespace: string
  ): Promise<AmpLocationRecord[]> {
    const rows = await db
      .table('client_locations')
      .select(
        'location_id',
        'client_id',
        'location_name',
        'address_line1',
        'address_line2',
        'city',
        'state_province',
        'postal_code',
        'country_code',
        'phone',
        'created_at',
        'updated_at'
      )
      .orderBy('location_id');
    return rows.map((row) => ({
      package_record_id: `loc-${row.location_id}`,
      source_record_id: row.location_id,
      external_identifier_namespace: namespace,
      organization_package_record_id: `org-${row.client_id}`,
      name: row.location_name || 'Location',
      address_line1: row.address_line1 || null,
      address_line2: row.address_line2 || null,
      city: row.city || null,
      region: row.state_province || null,
      postal_code: row.postal_code || null,
      country_code: normalizeCountryCode(row.country_code),
      phone: row.phone || null,
      created_at: toRfc3339(row.created_at),
      updated_at: toRfc3339(row.updated_at),
    }));
  }

  private async exportContacts(
    db: ReturnType<typeof tenantDb>,
    namespace: string
  ): Promise<AmpContactRecord[]> {
    const rows = await db
      .table('contacts')
      .select('contact_name_id', 'full_name', 'email', 'role', 'client_id', 'created_at', 'updated_at')
      .orderBy('contact_name_id');
    return rows.map((row) => {
      const nameParts = String(row.full_name ?? '').trim().split(/\s+/);
      const firstName = nameParts.slice(0, -1).join(' ') || nameParts[0] || null;
      const lastName = nameParts.length > 1 ? nameParts[nameParts.length - 1] : null;
      return {
        package_record_id: `contact-${row.contact_name_id}`,
        source_record_id: row.contact_name_id,
        external_identifier_namespace: namespace,
        organization_package_record_id: row.client_id ? `org-${row.client_id}` : null,
        first_name: firstName,
        last_name: lastName,
        email: row.email || null,
        title: row.role || null,
        created_at: toRfc3339(row.created_at),
        updated_at: toRfc3339(row.updated_at),
      };
    });
  }

  private async exportTickets(
    db: ReturnType<typeof tenantDb>,
    namespace: string
  ): Promise<AmpTicketRecord[]> {
    const rows = await db
      .table('tickets as t')
      .leftJoin('statuses as s', function join() {
        this.on('s.tenant', 't.tenant').andOn('s.status_id', 't.status_id');
      })
      .leftJoin('priorities as p', function join() {
        this.on('p.tenant', 't.tenant').andOn('p.priority_id', 't.priority_id');
      })
      .leftJoin('categories as c', function join() {
        this.on('c.tenant', 't.tenant').andOn('c.category_id', 't.category_id');
      })
      .leftJoin('clients as cl', function join() {
        this.on('cl.tenant', 't.tenant').andOn('cl.client_id', 't.client_id');
      })
      .select(
        't.ticket_id',
        't.title',
        't.client_id',
        't.contact_name_id',
        't.location_id',
        't.entered_at',
        't.updated_at',
        't.closed_at',
        's.name as status_name',
        'p.priority_name',
        'c.category_name'
      )
      .orderBy('t.ticket_id');
    return rows.map((row) => ({
      package_record_id: `ticket-${row.ticket_id}`,
      source_record_id: row.ticket_id,
      external_identifier_namespace: namespace,
      organization_package_record_id: row.client_id ? `org-${row.client_id}` : null,
      requester_package_record_id: row.contact_name_id ? `contact-${row.contact_name_id}` : null,
      location_package_record_id: row.location_id ? `loc-${row.location_id}` : null,
      title: row.title,
      status_name: row.status_name || null,
      priority_name: row.priority_name || null,
      category_name: row.category_name || null,
      closed_at: toRfc3339(row.closed_at),
      created_at: toRfc3339(row.entered_at),
      updated_at: toRfc3339(row.updated_at),
    }));
  }

  private async exportTicketComments(
    db: ReturnType<typeof tenantDb>,
    namespace: string
  ): Promise<AmpTicketCommentRecord[]> {
    const rows = await db
      .table('comments')
      .select('comment_id', 'ticket_id', 'note', 'is_internal', 'contact_id', 'created_at', 'updated_at')
      .whereNull('deleted_at')
      .whereNotNull('note')
      .orderBy('comment_id');
    return rows
      .filter((row) => String(row.note ?? '').trim().length > 0)
      .map((row) => ({
        package_record_id: `comment-${row.comment_id}`,
        source_record_id: row.comment_id,
        external_identifier_namespace: namespace,
        ticket_package_record_id: `ticket-${row.ticket_id}`,
        author_package_record_id: row.contact_id ? `contact-${row.contact_id}` : null,
        body: row.note,
        is_internal: row.is_internal ? 1 : 0,
        created_at: toRfc3339(row.created_at),
        updated_at: toRfc3339(row.updated_at),
      }));
  }

  private async exportAssets(
    db: ReturnType<typeof tenantDb>,
    namespace: string
  ): Promise<AmpAssetRecord[]> {
    const rows = await db
      .table('assets')
      .select(
        'asset_id',
        'name',
        'asset_type',
        'serial_number',
        'client_id',
        'location_id',
        'purchase_date',
        'attributes',
        'created_at',
        'updated_at'
      )
      .orderBy('asset_id');
    return rows.map((row) => {
      const attributes = (row.attributes ?? {}) as { manufacturer?: string; model?: string };
      return {
        package_record_id: `asset-${row.asset_id}`,
        source_record_id: row.asset_id,
        external_identifier_namespace: namespace,
        organization_package_record_id: row.client_id ? `org-${row.client_id}` : null,
        location_package_record_id: row.location_id ? `loc-${row.location_id}` : null,
        name: row.name,
        asset_type_name: row.asset_type || null,
        serial_number: row.serial_number || null,
        manufacturer: attributes.manufacturer ?? null,
        model: attributes.model ?? null,
        purchase_date: toDateOnly(row.purchase_date),
        created_at: toRfc3339(row.created_at),
        updated_at: toRfc3339(row.updated_at),
      };
    });
  }
}

function sanitizeTextLimits(rows: AmpPackageRows): AmpPackageDiagnosticRecord[] {
  const diagnostics: AmpPackageDiagnosticRecord[] = [];
  let diagnosticSequence = 0;

  for (const table of AMP_ENTITY_TABLES) {
    const tableRows = rows[table] as Array<Record<string, unknown>> | undefined;
    if (!tableRows) {
      continue;
    }
    for (const row of tableRows) {
      for (const [field, value] of Object.entries(row)) {
        if (typeof value !== 'string' || Buffer.byteLength(value, 'utf8') <= AMP_LIMITS.textBytes) {
          continue;
        }
        row[field] = truncateUtf8(value, AMP_LIMITS.textBytes);
        diagnosticSequence += 1;
        diagnostics.push({
          package_record_id: `truncation-${diagnosticSequence}`,
          severity: 'warning',
          code: 'TEXT_TRUNCATED',
          message: `Field "${field}" exceeded the ${AMP_LIMITS.textBytes}-byte text limit and was truncated.`,
          entity_type: table,
          entity_package_record_id: String(row.package_record_id ?? ''),
        });
      }
    }
  }
  return diagnostics;
}

function truncateUtf8(value: string, maxBytes: number): string {
  const buffer = Buffer.from(value, 'utf8');
  if (buffer.length <= maxBytes) {
    return value;
  }
  // toString on a sliced buffer never emits a broken code point; it replaces
  // a trailing partial sequence, which we then trim away.
  return buffer.subarray(0, maxBytes).toString('utf8').replace(/�+$/, '');
}

function toRfc3339(value: unknown): string | null {
  if (!value) {
    return null;
  }
  const date = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function toDateOnly(value: unknown): string | null {
  const timestamp = toRfc3339(value);
  return timestamp ? timestamp.slice(0, 10) : null;
}

function normalizeCountryCode(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim().toUpperCase();
  return /^[A-Z]{2}$/.test(trimmed) ? trimmed : null;
}
