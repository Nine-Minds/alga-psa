import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const indexerDir = __dirname;

const joinedIndexerFiles = [
  'client_contract.ts',
  'document.ts',
  'interaction.ts',
  'invoice.ts',
  'invoice_annotation.ts',
  'invoice_item.ts',
  'kb_article.ts',
  'project_phase.ts',
  'project_task.ts',
  'project_task_comment.ts',
  'schedule_entry.ts',
  'ticket.ts',
  'ticket_comment.ts',
  'time_entry.ts',
];

describe('search indexer tenant-scoped query contract', () => {
  it('uses structural tenant scoping for joined indexer root queries', () => {
    for (const file of joinedIndexerFiles) {
      const source = fs.readFileSync(path.join(indexerDir, file), 'utf8');

      expect(source).toContain('createTenantScopedIndexerQuery');
      expect(source).not.toMatch(/\.where\('(?:t|c|te|se|pt|pc|ph|cc|i|ii|ia|ka|d)\.tenant', tenant\)/);
    }
  });
});
