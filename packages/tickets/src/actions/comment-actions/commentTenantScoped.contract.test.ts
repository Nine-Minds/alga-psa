// @vitest-environment node

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(__dirname, '../../../../..');

function readRepoFile(relativePath: string): string {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

const sources = {
  commentModel: readRepoFile('packages/tickets/src/models/comment.ts'),
  commentActions: readRepoFile('packages/tickets/src/actions/comment-actions/commentActions.ts'),
  commentReactionActions: readRepoFile('packages/tickets/src/actions/comment-actions/commentReactionActions.ts'),
  clipboardImageDraftActions: readRepoFile('packages/tickets/src/actions/comment-actions/clipboardImageDraftActions.ts'),
  deleteTicketChildRecords: readRepoFile('packages/tickets/src/lib/deleteTicketChildRecords.ts'),
  clientPortalVisibilityServer: readRepoFile('packages/tickets/src/lib/clientPortalVisibility.server.ts'),
};

const metadataSource = readRepoFile('packages/db/src/lib/tenantTableMetadata.ts');

const coveredTenantTables = [
  'boards',
  'client_portal_visibility_group_boards',
  'client_portal_visibility_groups',
  'comment_reactions',
  'comment_threads',
  'comments',
  'contacts',
  'document_associations',
  'documents',
  'email_reply_tokens',
  'project_ticket_links',
  'sla_audit_log',
  'sla_notifications_sent',
  'ticket_audit_logs',
  'ticket_resources',
  'tickets',
  'users',
];

function directRootPattern(table: string): RegExp {
  return new RegExp(`\\b(?:db|trx|knex|knexOrTrx|conn)\\s*(?:<[^>]+>)?\\(\\s*['"]${table}(?:\\s+as\\s+\\w+)?['"]`);
}

describe('ticket comment tenant facade contract', () => {
  it('registers every tenant table used by migrated comment and portal roots', () => {
    for (const table of coveredTenantTables) {
      expect(metadataSource).toContain(`${table}: { scope: 'tenant' }`);
    }
  });

  it('keeps migrated comment and portal roots behind tenantDb', () => {
    for (const source of Object.values(sources)) {
      expect(source).toContain('tenantDb');
      expect(source).not.toContain('createTenantScopedQuery');
      expect(source).not.toMatch(/\.where\(\{[^}\n]*(?:\btenant\b|['"][^'"]*\.tenant['"])/);
      expect(source).not.toMatch(/\.andWhere\([^)\n]*(?:\btenant\b|['"][^'"]*\.tenant['"])/);
      expect(source).not.toMatch(/\.(?:where|andWhere)\(\s*['"](?:tenant|[^'"]+\.tenant)['"]/);
      expect(source).not.toMatch(/\.andOn\([^)\n]*tenant/);

      for (const table of coveredTenantTables) {
        expect(source).not.toMatch(directRootPattern(table));
      }
    }
  });

  it('uses facade joins for migrated comment and portal tenant-table joins', () => {
    expect(sources.commentModel).toContain("tenantScopedTable(knexOrTrx, 'comments as parent', tenant)");
    expect(sources.commentModel).toContain("'comment_threads as thread'");

    expect(sources.commentActions).toContain("tenantScopedTable(trx, 'users as u', tenant)");
    expect(sources.commentActions).toContain("'contacts as c'");

    expect(sources.clipboardImageDraftActions).toContain("tenantScopedTable(trx, 'documents as d', tenant)");
    expect(sources.clipboardImageDraftActions).toContain("'document_associations as da'");

    expect(sources.clientPortalVisibilityServer).toContain("'client_portal_visibility_group_boards as cvgb'");
    expect(sources.clientPortalVisibilityServer).toContain("'boards as b'");
  });

  it('keeps raw generated and computed values on the connection', () => {
    expect(sources.commentModel).toContain("knexOrTrx.raw('SELECT gen_random_uuid() AS comment_id')");
    expect(sources.commentModel).toContain("knexOrTrx.raw('SELECT gen_random_uuid() AS comment_id, gen_random_uuid() AS thread_id')");
    expect(sources.commentModel).toContain("knexOrTrx.raw('reply_count + 1')");
    expect(sources.commentModel).toContain("knexOrTrx.raw('GREATEST(reply_count - 1, 0)')");
    expect(sources.deleteTicketChildRecords).toContain('trx.raw(');
  });
});
