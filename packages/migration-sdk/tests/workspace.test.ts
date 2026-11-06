import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AMP_ENTITY_TABLES, type AmpPackageRows } from '@alga-psa/migration-spec';
import { AmpPackageBuilder, AmpSqliteReader, sampleEntityRows, sampleManifest, validateAmpPackage } from '../src/index';
import fixture from './fixtures/workspace.json';

function workspace() { return { ...sampleEntityRows(), ...structuredClone(fixture) } as AmpPackageRows; }
function packageWith(rows: AmpPackageRows, check: (path: string) => void) {
  const dir = mkdtempSync(join(tmpdir(), 'amp-conformance-'));
  try {
    const content = Buffer.from('conforming file content'), path = join(dir, 'workspace.amp'), filePath = join(dir, 'file');
    const sha256 = createHash('sha256').update(content).digest('hex');
    writeFileSync(filePath, content);
    rows.attachments = [{ package_record_id: 'attachment-example', entity_type: 'files', entity_package_record_id: 'files-example', sha256, size: content.length }];
    new AmpPackageBuilder(path).write(sampleManifest(), rows, [{ filePath, sha256, size: content.length }]);
    check(path);
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
describe('neutral workspace conformance', () => {
  it('round trips every allowlisted domain and file bytes through the public SDK', () => {
    packageWith(workspace(), path => {
      expect(validateAmpPackage(path)).toMatchObject({ valid: true, diagnostics: [] });
      const reader = new AmpSqliteReader(path);
      try {
        for (const table of AMP_ENTITY_TABLES) expect(reader.rowCount(table)).toBe(1);
        expect(reader.allRows('contact_phones')[0].number).toBe('+0012345');
        expect(reader.allRows('asset_facts')[0].number).toBe(1.5);
        expect(reader.allRows('work_items')[0].phase_package_record_id).toBe('project_phases-example');
        expect(reader.allRows('workflow_versions')[0].definition).toBe('{"content": "example"}');
        const sha = String(reader.allRows('attachments')[0].sha256);
        expect(readFileSync(reader.attachmentPath(sha)!)).toEqual(Buffer.from('conforming file content'));
      } finally { reader.close(); }
    });
  });
  it('rejects invalid cross-domain ownership and invalid workspace values', () => {
    const rows = workspace();
    rows.work_items![0].phase_package_record_id = 'missing-phase';
    rows.document_folders![0].parent_package_record_id = 'document_folders-example';
    rows.time_records![0].starts_at = 'not-a-timestamp';
    rows.document_blocks![0].blocks = '{broken-json';
    rows.document_links![0].target_id = 'missing-target';
    rows.documents![0].body = '[missing](amp://files/unknown/download)';
    packageWith(rows, path => {
      const result = validateAmpPackage(path);
      expect(result.valid).toBe(false);
      expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: 'AMP_INVALID_REFERENCE', table: 'document_folders' }));
      expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: 'AMP_INVALID_REFERENCE', table: 'work_items' }));
      expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: 'AMP_INVALID_VALUE', field: 'starts_at' }));
      expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: 'AMP_INVALID_VALUE', field: 'blocks' }));
      expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: 'AMP_INVALID_REFERENCE', table: 'document_links' }));
      expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: 'AMP_INVALID_REFERENCE', table: 'documents', field: 'body' }));
    });
  });
});
