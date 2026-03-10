import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('DocumentStorageCard preview contract', () => {
  it('uses document_id before file_id for legacy preview lookup', () => {
    const filePath = path.resolve(__dirname, './DocumentStorageCard.tsx');
    const source = fs.readFileSync(filePath, 'utf-8');

    expect(source).toContain('const identifierForPreview = document.document_id || document.file_id;');
    expect(source).toContain('const preview = await getDocumentPreview(identifierForPreview);');
  });
});
