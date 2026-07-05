import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const indexerDir = __dirname;

const tenantScopedIndexerFiles = [
  'asset.ts',
  'board.ts',
  'category.ts',
  'client_contract.ts',
  'client.ts',
  'contact.ts',
  'contract.ts',
  'document.ts',
  'interaction.ts',
  'invoice.ts',
  'invoice_annotation.ts',
  'invoice_item.ts',
  'kb_article.ts',
  'project.ts',
  'project_phase.ts',
  'project_task.ts',
  'project_task_comment.ts',
  'schedule_entry.ts',
  'service_catalog.ts',
  'service_request_definition.ts',
  'service_request_submission.ts',
  'status.ts',
  'tag.ts',
  'ticket.ts',
  'ticket_comment.ts',
  'time_entry.ts',
  'user.ts',
  'workflow_task.ts',
];

describe('search indexer tenant-scoped query contract', () => {
  it('uses structural tenant scoping for indexer root queries', () => {
    for (const file of tenantScopedIndexerFiles) {
      const source = fs.readFileSync(path.join(indexerDir, file), 'utf8');

      expect(source).toContain('createTenantScopedIndexerQuery');
      expect(source).not.toMatch(/\.where\('(?:[a-z_]+\.)?tenant', tenant\)/);
    }
  });
});
