import type { Knex } from 'knex';
import { v5 as uuidv5, v4 as uuidv4 } from 'uuid';
import { tenantDb } from '@alga-psa/db';

/**
 * Canonical read/write of a ticket's links to other entities.
 *
 * One canonical store per entity type:
 *  - `asset`                               -> `asset_associations` (entity_type='ticket'), the table the UI, REST
 *                                             API and RMM alert paths all use.
 *  - `project | project_task | contract`   -> `ticket_entity_links`.
 * Legacy `asset` rows in `ticket_entity_links` (written by earlier `tickets.link_entities` runs) are surfaced
 * on read, de-duplicated against `asset_associations`, and marked `legacy`.
 */

export const TICKET_LINK_ENTITY_TYPES = ['asset', 'project', 'project_task', 'contract'] as const;
export type TicketLinkEntityType = (typeof TICKET_LINK_ENTITY_TYPES)[number];

export const TICKET_LINK_MAX_LIMIT = 100;
export const TICKET_LINK_DEFAULT_LIMIT = 25;

export type TicketLinkSource = 'asset_associations' | 'ticket_entity_links';

export type TicketLinkExternalId = {
  integration_type: string;
  external_entity_id: string;
  external_realm_id: string | null;
};

export type TicketLink = {
  entity_type: TicketLinkEntityType;
  entity_id: string;
  name: string | null;
  relationship_type: string;
  linked_at: string | null;
  source: TicketLinkSource;
  legacy?: boolean;
  asset?: {
    asset_id: string;
    asset_tag: string | null;
    asset_name: string | null;
    asset_type: string | null;
    client_id: string | null;
  };
  external_ids?: TicketLinkExternalId[];
};

export type ListTicketLinksParams = {
  ticketId: string;
  entityType?: TicketLinkEntityType | 'all';
  relationshipType?: string;
  includeExternalIds?: boolean;
  limit?: number;
};

export class TicketLinkError extends Error {
  constructor(public code: 'NOT_FOUND' | 'CONFLICT', message: string) {
    super(message);
    this.name = 'TicketLinkError';
  }
}

const iso = (value: unknown): string | null => {
  if (value === null || value === undefined || value === '') return null;
  const d = new Date(value as string | Date);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};

const clampLimit = (limit?: number): number =>
  Math.min(Math.max(Math.trunc(limit ?? TICKET_LINK_DEFAULT_LIMIT), 1), TICKET_LINK_MAX_LIMIT);

export async function ticketExists(trx: Knex.Transaction, tenant: string, ticketId: string): Promise<boolean> {
  const row = await tenantDb(trx, tenant).table('tickets').where({ ticket_id: ticketId }).first('ticket_id');
  return Boolean(row);
}

// ---------------------------------------------------------------------------
// Per-type descriptors: how to resolve (name) and read each entity type.
// ---------------------------------------------------------------------------

type Db = ReturnType<typeof tenantDb>;

type EntityDescriptor = {
  /** Looks the target entity up for existence + display name. Returns null when it does not exist. */
  resolve: (db: Db, entityId: string) => Promise<{ name: string | null } | null>;
};

const firstString = (...values: unknown[]): string | null => {
  for (const v of values) if (typeof v === 'string' && v.length > 0) return v;
  return null;
};

// LEVERAGE: pattern ticket-asset-association-write — asset_associations inserts exist in TicketService.linkAsset, assetTicketAssociation.ts and here; one shared writer would remove the drift
const ENTITY_TABLES: Record<Exclude<TicketLinkEntityType, 'asset'>, { table: string; idColumn: string; nameColumns: string[] }> = {
  project: { table: 'projects', idColumn: 'project_id', nameColumns: ['project_name'] },
  project_task: { table: 'project_tasks', idColumn: 'task_id', nameColumns: ['task_name'] },
  contract: { table: 'contracts', idColumn: 'contract_id', nameColumns: ['contract_name', 'name', 'contract_number'] },
};

const DESCRIPTORS: Record<TicketLinkEntityType, EntityDescriptor> = {
  asset: {
    resolve: async (db, id) => {
      const asset = await db.table('assets').where({ asset_id: id }).first();
      return asset ? { name: firstString(asset.asset_name, asset.name, asset.asset_tag) } : null;
    },
  },
  ...(Object.fromEntries(
    Object.entries(ENTITY_TABLES).map(([type, cfg]) => [
      type,
      {
        resolve: async (db: Db, id: string) => {
          const row = await db.table(cfg.table).where({ [cfg.idColumn]: id }).first().catch(() => null);
          return row ? { name: firstString(...cfg.nameColumns.map((c) => row[c])) } : null;
        },
      } satisfies EntityDescriptor,
    ])
  ) as Record<Exclude<TicketLinkEntityType, 'asset'>, EntityDescriptor>),
};

export async function resolveLinkTarget(
  trx: Knex.Transaction,
  tenant: string,
  entityType: TicketLinkEntityType,
  entityId: string
): Promise<{ name: string | null } | null> {
  return DESCRIPTORS[entityType].resolve(tenantDb(trx, tenant), entityId);
}

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

async function listAssetLinks(
  db: Db,
  p: ListTicketLinksParams,
  limit: number
): Promise<TicketLink[]> {
  const q = db.table('asset_associations as aa');
  db.tenantJoin(q, 'assets as a', 'a.asset_id', 'aa.asset_id', { rootTenantColumn: 'aa.tenant' });
  q.where({ 'aa.entity_type': 'ticket', 'aa.entity_id': p.ticketId });
  if (p.relationshipType) q.andWhere('aa.relationship_type', p.relationshipType);
  const rows = (await q
    .select(
      'aa.asset_id',
      'aa.relationship_type',
      'aa.created_at',
      'a.asset_tag',
      'a.name as asset_name',
      'a.asset_type',
      'a.client_id'
    )
    .orderBy('aa.created_at', 'desc')
    .orderBy('aa.asset_id')
    .limit(limit)) as Array<Record<string, any>>;

  const links: TicketLink[] = rows.map((r) => ({
    entity_type: 'asset',
    entity_id: r.asset_id,
    name: firstString(r.asset_name, r.asset_tag),
    relationship_type: r.relationship_type,
    linked_at: iso(r.created_at),
    source: 'asset_associations',
    asset: {
      asset_id: r.asset_id,
      asset_tag: r.asset_tag ?? null,
      asset_name: r.asset_name ?? null,
      asset_type: r.asset_type ?? null,
      client_id: r.client_id ?? null,
    },
  }));

  return links;
}

async function listLegacyAndEntityLinks(
  db: Db,
  p: ListTicketLinksParams,
  types: TicketLinkEntityType[],
  limit: number
): Promise<TicketLink[]> {
  if (types.length === 0) return [];
  const q = db
    .table('ticket_entity_links')
    .where({ ticket_id: p.ticketId })
    .whereIn('entity_type', types);
  if (p.relationshipType) q.andWhere('link_type', p.relationshipType);
  const rows = (await q.select('entity_type', 'entity_id', 'link_type', 'created_at')
    .orderBy('created_at', 'desc')
    .orderBy('entity_id')
    .limit(limit)) as Array<Record<string, any>>;

  const links: TicketLink[] = [];
  for (const r of rows) {
    const type = r.entity_type as TicketLinkEntityType;
    const target = DESCRIPTORS[type] ? await DESCRIPTORS[type].resolve(db, r.entity_id) : null;
    const link: TicketLink = {
      entity_type: type,
      entity_id: r.entity_id,
      name: target?.name ?? null,
      relationship_type: r.link_type,
      linked_at: iso(r.created_at),
      source: 'ticket_entity_links',
    };
    if (type === 'asset') link.legacy = true;
    links.push(link);
  }
  return links;
}

async function attachAssetDetails(db: Db, links: TicketLink[], includeExternalIds: boolean): Promise<void> {
  const assetLinks = links.filter((l) => l.entity_type === 'asset');
  if (assetLinks.length === 0) return;
  const ids = assetLinks.map((l) => l.entity_id);

  // Legacy rows have no joined asset data yet.
  const needDetails = assetLinks.filter((l) => !l.asset);
  if (needDetails.length > 0) {
    const assets = (await db
      .table('assets')
      .whereIn('asset_id', needDetails.map((l) => l.entity_id))
      .select('asset_id', 'asset_tag', 'name', 'asset_type', 'client_id')) as Array<Record<string, any>>;
    const byId = new Map(assets.map((a) => [a.asset_id, a]));
    for (const l of needDetails) {
      const a = byId.get(l.entity_id);
      if (!a) continue;
      l.name = l.name ?? firstString(a.name, a.asset_tag);
      l.asset = {
        asset_id: a.asset_id,
        asset_tag: a.asset_tag ?? null,
        asset_name: a.name ?? null,
        asset_type: a.asset_type ?? null,
        client_id: a.client_id ?? null,
      };
    }
  }

  if (!includeExternalIds) return;
  // alga_entity_id is varchar; asset ids are uuid strings, so compare as text.
  const mappings = (await db
    .table('tenant_external_entity_mappings')
    .where({ alga_entity_type: 'asset' })
    .whereIn('alga_entity_id', ids)
    .select('alga_entity_id', 'integration_type', 'external_entity_id', 'external_realm_id')
    .orderBy('integration_type')
    .orderBy('external_entity_id')) as Array<Record<string, any>>;
  const grouped = new Map<string, TicketLinkExternalId[]>();
  for (const m of mappings) {
    const list = grouped.get(m.alga_entity_id) ?? [];
    list.push({
      integration_type: m.integration_type,
      external_entity_id: m.external_entity_id,
      external_realm_id: m.external_realm_id ?? null,
    });
    grouped.set(m.alga_entity_id, list);
  }
  for (const l of assetLinks) l.external_ids = grouped.get(l.entity_id) ?? [];
}

export async function listTicketLinks(
  trx: Knex.Transaction,
  tenant: string,
  params: ListTicketLinksParams
): Promise<TicketLink[]> {
  const db = tenantDb(trx, tenant);
  const limit = clampLimit(params.limit);
  const requested = params.entityType ?? 'all';
  const types: TicketLinkEntityType[] = requested === 'all' ? [...TICKET_LINK_ENTITY_TYPES] : [requested];

  const links: TicketLink[] = [];
  const assetSeen = new Set<string>();
  if (types.includes('asset')) {
    for (const l of await listAssetLinks(db, params, limit)) {
      assetSeen.add(l.entity_id);
      links.push(l);
    }
  }
  // Everything else (and legacy asset rows) comes from ticket_entity_links.
  for (const l of await listLegacyAndEntityLinks(db, params, types, limit)) {
    if (l.entity_type === 'asset') {
      // De-duplicate legacy rows against the canonical store.
      if (assetSeen.has(l.entity_id)) continue;
      assetSeen.add(l.entity_id);
    }
    links.push(l);
  }

  await attachAssetDetails(db, links, params.includeExternalIds ?? true);

  links.sort((a, b) => {
    const at = a.linked_at ?? '';
    const bt = b.linked_at ?? '';
    if (at !== bt) return at < bt ? 1 : -1;
    return a.entity_id < b.entity_id ? -1 : a.entity_id > b.entity_id ? 1 : 0;
  });
  return links.slice(0, limit);
}

// ---------------------------------------------------------------------------
// Write
// ---------------------------------------------------------------------------

export type LinkTicketEntityParams = {
  ticketId: string;
  entityType: TicketLinkEntityType;
  entityId: string;
  linkType: string;
  metadata?: Record<string, unknown>;
  actorUserId: string;
};

export type LinkTicketEntityResult = {
  link_id: string;
  entity_type: TicketLinkEntityType;
  entity_id: string;
  link_type: string;
  name: string | null;
  source: TicketLinkSource;
  /** True when an identical asset link already existed (asset links are idempotent). */
  already_linked: boolean;
};

// asset_associations has no link_id column; derive a stable one from its primary key.
const ASSET_LINK_NAMESPACE = '3d6b1c0e-7a52-4f0b-9a77-0c1d5b6a2e11';

const ASSET_RELATIONSHIPS = new Set(['affected', 'related']);

export async function linkTicketEntity(
  trx: Knex.Transaction,
  tenant: string,
  params: LinkTicketEntityParams
): Promise<LinkTicketEntityResult> {
  const db = tenantDb(trx, tenant);
  if (!(await ticketExists(trx, tenant, params.ticketId))) {
    throw new TicketLinkError('NOT_FOUND', 'Ticket not found');
  }
  const target = await DESCRIPTORS[params.entityType].resolve(db, params.entityId);
  if (!target) {
    const label = params.entityType === 'project_task' ? 'Project task' : params.entityType[0].toUpperCase() + params.entityType.slice(1);
    throw new TicketLinkError('NOT_FOUND', `${label} not found`);
  }
  const nowIso = new Date().toISOString();

  if (params.entityType === 'asset') {
    const relationship = ASSET_RELATIONSHIPS.has(params.linkType) ? params.linkType : 'affected';
    const notes = [
      ASSET_RELATIONSHIPS.has(params.linkType) ? null : `link_type: ${params.linkType}`,
      params.metadata && Object.keys(params.metadata).length > 0 ? JSON.stringify(params.metadata) : null,
    ].filter(Boolean).join('\n') || null;

    const inserted = await db
      .table('asset_associations')
      .insert({
        tenant,
        asset_id: params.entityId,
        entity_id: params.ticketId,
        entity_type: 'ticket',
        relationship_type: relationship,
        notes,
        created_by: params.actorUserId,
        created_at: nowIso,
      })
      .onConflict(['tenant', 'asset_id', 'entity_id', 'entity_type'])
      .ignore()
      .returning('asset_id');

    const existing = await db
      .table('asset_associations')
      .where({ asset_id: params.entityId, entity_id: params.ticketId, entity_type: 'ticket' })
      .first('relationship_type');
    return {
      link_id: uuidv5(`${params.entityId}:${params.ticketId}`, ASSET_LINK_NAMESPACE),
      entity_type: 'asset',
      entity_id: params.entityId,
      link_type: existing?.relationship_type ?? relationship,
      name: target.name,
      source: 'asset_associations',
      already_linked: Array.isArray(inserted) ? inserted.length === 0 : false,
    };
  }

  const linkId = uuidv4();
  try {
    await db.table('ticket_entity_links').insert({
      tenant,
      link_id: linkId,
      ticket_id: params.ticketId,
      entity_type: params.entityType,
      entity_id: params.entityId,
      link_type: params.linkType,
      metadata: params.metadata ?? null,
      created_at: nowIso,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if (/duplicate|unique/i.test(msg)) throw new TicketLinkError('CONFLICT', 'Link already exists');
    throw error;
  }
  return {
    link_id: linkId,
    entity_type: params.entityType,
    entity_id: params.entityId,
    link_type: params.linkType,
    name: target.name,
    source: 'ticket_entity_links',
    already_linked: false,
  };
}
