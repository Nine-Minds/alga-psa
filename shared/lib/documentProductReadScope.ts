import type { IUser } from '@alga-psa/types';
import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';

/** Byte-serving routes already load a document before authorization. Embed the
 * customer product restriction in that existing read instead of adding a
 * product/RBAC round trip to every native PSA file request. The ordinary
 * document relationship/redaction policy still runs on the result. */
export function applyDocumentProductReadScope(query: Knex.QueryBuilder, conn: Knex | Knex.Transaction, user: IUser): void {
  const db = tenantDb(conn, user.tenant);
  const grants = (resource: string) => {
    const permissions = db.table('permissions as p').select('p.permission_id')
      .where({ 'p.resource': resource, 'p.action': 'read', [user.user_type === 'client' ? 'p.client' : 'p.msp']: true });
    db.tenantJoin(permissions, 'role_permissions as rp', 'rp.permission_id', 'p.permission_id');
    db.tenantJoin(permissions, 'user_roles as ur', 'ur.role_id', 'rp.role_id');
    db.tenantJoin(permissions, 'roles as r', 'r.role_id', 'ur.role_id');
    return permissions.where({ 'ur.user_id': user.user_id, [user.user_type === 'client' ? 'r.client' : 'r.msp']: true });
  };
  const associations = db.table('document_associations as da').select('da.document_id')
    .where('da.entity_type', 'ticket').where('da.document_id', conn.ref('documents.document_id'));
  db.tenantJoin(associations, 'tickets as t', 't.ticket_id', 'da.entity_id');
  const drafts = db.table('ticket_comment_attachments as a').select('a.document_id')
    .where({ 'a.created_by': user.user_id, 'a.state': 'draft' }).where('a.document_id', conn.ref('documents.document_id'));
  db.tenantJoin(drafts, 'tickets as t', 't.ticket_id', 'a.ticket_id');
  query.andWhere(function () {
    this.whereNotExists(db.table('tenants').select('tenant').where('product_code', 'co_managed'))
      .orWhereExists(grants('document'))
      .orWhere(function () {
        this.whereExists(grants('ticket_attachment')).whereExists(grants('ticket'))
          .andWhere(function () { this.whereExists(associations).orWhereExists(drafts); });
      });
  });
}
