import type { Knex } from 'knex';

/**
 * Content audiences: who may read a piece of content owned by an organization (a ticket comment,
 * a document). The audience is a stored label on the content; this module is the ONE predicate
 * that turns (audience, owner, reader) into visible / not visible, in TypeScript and in SQL.
 * Callers derive the audience their own way (comments from thread and root, documents from a
 * column) and then ask here. There is no second predicate.
 *
 * Audience is an ADDITIONAL restriction applied after resource/principal authorization. It never
 * grants anything.
 */
export const CONTENT_AUDIENCES = ['requester', 'shared_it', 'organization_private'] as const;
export type ContentAudience = (typeof CONTENT_AUDIENCES)[number];

export function isContentAudience(value: unknown): value is ContentAudience {
  return typeof value === 'string' && (CONTENT_AUDIENCES as readonly string[]).includes(value);
}

/**
 * WHO is reading, as an organization rather than a tenant.
 *
 * An organization is usually a whole tenant (`staff`): the MSP on its own content, or either side
 * of a co-managed workspace relationship. The seat shape puts a second organization INSIDE the
 * sponsor's tenant: a `seat` technician is an internal user of that tenant whose organization is
 * the one client named by their live seat assignment. `requester` is the content's own client
 * contact side (the client portal).
 */
export type ContentAudienceReader =
  | { kind: 'staff'; tenant: string }
  | { kind: 'seat'; tenant: string; clientId: string }
  | { kind: 'requester'; tenant: string };

/** The organization that owns the content: the tenant that stores it and the content's client. */
export interface ContentAudienceOwner {
  tenant: string;
  /** The client the content belongs to (e.g. `tickets.client_id`). A seat technician sees nothing without it. */
  clientId?: string | null;
}

/**
 * Audience is an additional restriction after resource and principal authorization.
 *
 *   requester             everyone admitted to the content
 *   shared_it             staff of either tenant, and seat technicians of the owning client
 *   organization_private  staff of the owning tenant only
 *
 * A seat technician reads only their own client's content in their own tenant; a requester only
 * ever sees `requester`. Anything missing fails closed. With no seat reader this is exactly the
 * old tenant comparison. `contentAudienceVisibleSql` is the SQL twin.
 */
export function isContentAudienceVisible(
  audience: ContentAudience,
  owner: ContentAudienceOwner,
  reader: ContentAudienceReader | null | undefined,
): boolean {
  if (!owner?.tenant || !reader?.tenant || !isContentAudience(audience)) return false;
  switch (reader.kind) {
    case 'requester':
      return audience === 'requester';
    case 'seat':
      return !!reader.clientId && reader.tenant === owner.tenant && reader.clientId === owner.clientId
        && audience !== 'organization_private';
    case 'staff':
      return audience !== 'organization_private' || owner.tenant === reader.tenant;
    default:
      return false;
  }
}

/** Where a query exposes the content's audience and its owning organization. */
export interface ContentAudienceSqlSource {
  /**
   * The audience as an expression: a column name (bound as an identifier, e.g. `'d.audience'`) or a
   * `Knex.Raw` that yields one of the three audiences (e.g. `commentAudienceSql`).
   */
  audience: string | Knex.Raw;
  /** Column holding the tenant that stores the content, e.g. `'c.tenant'`. */
  ownerTenant: string;
  /** Column holding the content's client, e.g. `'t.client_id'`. Required for a seat reader. */
  ownerClient?: string;
}

/**
 * SQL twin of `isContentAudienceVisible`: a boolean expression over the audience expression and the
 * owning organization's columns for one reader. The reader is a value known before the query;
 * the audience and the owner come from the row. Fails closed (`FALSE`) exactly where the
 * TypeScript form does. Identifiers are bound (`??`), values are bound (`?`).
 */
export function contentAudienceVisibleSql(
  db: Knex | Knex.Transaction,
  reader: ContentAudienceReader | null | undefined,
  source: ContentAudienceSqlSource,
): Knex.Raw {
  if (!reader?.tenant) return db.raw('FALSE');
  const audience = typeof source.audience === 'string' ? db.raw('??', [source.audience]) : source.audience;
  switch (reader.kind) {
    case 'requester':
      return db.raw(`((?) = 'requester')`, [audience]);
    case 'seat':
      if (!reader.clientId || !source.ownerClient) return db.raw('FALSE');
      return db.raw(`((?) <> 'organization_private' AND ?? = ? AND ?? IS NOT DISTINCT FROM ?)`,
        [audience, source.ownerTenant, reader.tenant, source.ownerClient, reader.clientId]);
    case 'staff':
      return db.raw(`((?) <> 'organization_private' OR ?? = ?)`, [audience, source.ownerTenant, reader.tenant]);
    default:
      return db.raw('FALSE');
  }
}

/** The audiences a reader of this kind reads on content of their own organization, by the one predicate. */
export function contentAudiencesVisibleTo(kind: ContentAudienceReader['kind']): ContentAudience[] {
  const tenant = 'owner', clientId = 'client';
  const reader: ContentAudienceReader = kind === 'seat' ? { kind, tenant, clientId } : { kind, tenant };
  return CONTENT_AUDIENCES.filter(audience => isContentAudienceVisible(audience, { tenant, clientId }, reader));
}
