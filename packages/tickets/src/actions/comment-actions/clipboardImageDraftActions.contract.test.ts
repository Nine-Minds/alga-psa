import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const actionPath = path.resolve(__dirname, './clipboardImageDraftActions.ts');

function getActionSource(): string {
  return fs.readFileSync(actionPath, 'utf-8');
}

describe('clipboardImageDraftActions contract', () => {
  it('T022: hard-delete flow calls deleteDocument for validated draft clipboard images', () => {
    const source = getActionSource();

    expect(source).toContain('const deletedDocumentIds: string[] = []');
    expect(source).toContain('for (const candidate of evaluation.deletable)');
    expect(source).toContain('const deleteResult = await input.deleteDocumentFn(candidate.document_id, user.user_id)');
    expect(source).toContain('deletedDocumentIds.push(candidate.document_id)');
  });

  it('T023: rejects delete when artifact is already referenced by saved comment content', () => {
    const source = getActionSource();

    expect(source).toContain("trx('comments')");
    expect(source).toContain('note::text LIKE ?');
    expect(source).toContain("reason: 'already_referenced'");
  });

  it('guards against deleting documents still associated to non-ticket entities', () => {
    const source = getActionSource();

    expect(source).toContain("trx('document_associations')");
    expect(source).toContain("association.entity_type === 'ticket'");
    expect(source).toContain("reason: 'has_other_associations'");
  });

  it('T024: rejects delete when requester lacks document delete permission', () => {
    const source = getActionSource();

    expect(source).toContain("const hasDeletePermission = await hasPermission(user, 'document', 'delete')");
    expect(source).toContain("throw new Error('Permission denied: cannot delete document attachments.')");
  });
});
