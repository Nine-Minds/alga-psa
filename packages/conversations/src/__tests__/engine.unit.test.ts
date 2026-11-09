import { describe, expect, it, vi } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  CONVERSATION_FILE_MAX_BYTES, conversationFileUploadLimit, snapshotConversationFile, assertConversationFilePath, conversationFilePath,
  registerConversationFileOwner, getConversationFileOwner, unregisterConversationFileOwner, describeConversationFile,
  assertConversationFileBytes, sha256Hex,
} from '../files';
import { createConversationFileDownloadHandler, conversationFileResponseHeaders } from '../files/download';

const id = () => crypto.randomUUID();

describe('limits', () => {
  it('named constants and body-limit helper (parity with the co-managed helper)', () => {
    expect(CONVERSATION_FILE_MAX_BYTES).toBe(25 * 1024 * 1024);
    expect(conversationFileUploadLimit('20mb')).toBe(20 * 1024 * 1024 - 65536);
    expect(conversationFileUploadLimit('100mb')).toBe(26_214_400);
    expect(conversationFileUploadLimit('garbage')).toBe(0);
  });
});

describe('snapshot', () => {
  it('validates and hashes; boundary size passes, one over fails', () => {
    const ok = snapshotConversationFile({ fileName: 'a.txt', mimeType: 'Text/Plain', content: new Uint8Array(CONVERSATION_FILE_MAX_BYTES) });
    expect(ok.size).toBe(CONVERSATION_FILE_MAX_BYTES); expect(ok.mimeType).toBe('text/plain');
    for (const bad of [{ fileName: '', mimeType: 'text/plain' }, { fileName: 'a/b', mimeType: 'text/plain' }, { fileName: 'a', mimeType: 'nope' }])
      expect(() => snapshotConversationFile({ ...bad, content: new Uint8Array(1) })).toThrowError(expect.objectContaining({ code: 'INVALID_FILE' }));
    expect(() => snapshotConversationFile({ fileName: 'a', mimeType: 'text/plain', content: new Uint8Array(CONVERSATION_FILE_MAX_BYTES + 1) })).toThrowError(expect.objectContaining({ code: 'INVALID_FILE' }));
  });
  it('derives and asserts the storage path; verifies bytes', () => {
    const tenant = id(), file_id = id();
    expect(() => assertConversationFilePath({ tenant, file_id, storage_path: conversationFilePath(tenant, file_id) })).not.toThrow();
    expect(() => assertConversationFilePath({ tenant, file_id, storage_path: '../../etc/passwd' })).toThrowError(expect.objectContaining({ code: 'FILE_NOT_FOUND' }));
    const content = new TextEncoder().encode('x');
    expect(() => assertConversationFileBytes(content, { size: 1, contentHash: sha256Hex(content) })).not.toThrow();
    expect(() => assertConversationFileBytes(content, { size: 1, contentHash: sha256Hex('y') })).toThrowError(expect.objectContaining({ code: 'FILE_CONTENT_MISMATCH' }));
  });
  it('descriptor carries no path, url or bytes', () => {
    const d = describeConversationFile({ tenant: id(), file_id: id(), file_name: 'a', mime_type: 'text/plain', file_size: 3, content_hash: 'a'.repeat(64) });
    expect(Object.keys(d).sort()).toEqual(['contentHash', 'fileId', 'fileName', 'mimeType', 'size', 'tenant']);
  });
});

describe('owner registry', () => {
  it('validates owner type, is process-global, and unknown types are absent', () => {
    const adapter = { canRead: async () => true, canWrite: async () => true };
    expect(() => registerConversationFileOwner('Bad Type', adapter)).toThrow();
    registerConversationFileOwner('unit_owner', adapter);
    expect(getConversationFileOwner('unit_owner')).toBe(adapter);
    expect(unregisterConversationFileOwner('unit_owner')).toBe(true);
    expect(getConversationFileOwner('unit_owner')).toBeUndefined();
  });
});

describe('download route adapter', () => {
  const deps = (guard: () => Response | null) => {
    const getDb = vi.fn(); const resolveActor = vi.fn(async () => null); const storage = vi.fn();
    return { handler: createConversationFileDownloadHandler({ guard, resolveActor, getDb, storage }), getDb, resolveActor, storage };
  };
  it('returns 404 with zero session/DB/storage work when the capability guard is closed (R2)', async () => {
    const { handler, getDb, resolveActor, storage } = deps(() => new Response('Not found', { status: 404 }));
    const res = await handler(new Request('http://x/f'), { params: Promise.resolve({ fileId: id() }) });
    expect(res.status).toBe(404);
    expect(getDb).not.toHaveBeenCalled(); expect(resolveActor).not.toHaveBeenCalled(); expect(storage).not.toHaveBeenCalled();
  });
  it('no session is a 404 and touches no database', async () => {
    const { handler, getDb } = deps(() => null);
    expect((await handler(new Request('http://x/f'), { params: { fileId: id() } })).status).toBe(404);
    expect(getDb).not.toHaveBeenCalled();
  });
  it('hardened headers', () => {
    const h = conversationFileResponseHeaders('résumé "x".txt', 4);
    expect(h['Content-Type']).toBe('application/octet-stream'); expect(h['X-Content-Type-Options']).toBe('nosniff');
    expect(h['Cache-Control']).toBe('no-store, private'); expect(h['Content-Security-Policy']).toContain('sandbox');
    expect(h['Content-Disposition']).toContain("filename*=UTF-8''r%C3%A9sum%C3%A9");
  });
});

describe('contracts', () => {
  const root = resolve(__dirname, '../../../..');
  const walk = (dir: string, out: string[] = []): string[] => {
    for (const name of readdirSync(dir)) {
      if (name === 'node_modules' || name === 'dist' || name === '.next') continue;
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p, out); else if (/\.(ts|tsx|mjs|cjs|js)$/.test(name) && !/\.(test|spec)\./.test(name)) out.push(p);
    }
    return out;
  };
  it('no worker entry statically imports @alga-psa/conversations (workers boot if it fails to resolve)', () => {
    for (const dir of ['services/workflow-worker/src', 'services/email-service/src', 'ee/temporal-workflows/src']) {
      for (const file of walk(join(root, dir))) expect(readFileSync(file, 'utf8'), file).not.toMatch(/(from|import\(|require\()\s*['"]@alga-psa\/conversations/);
    }
  });
  it('the client-safe entry pulls in no server module', () => {
    const src = readFileSync(join(root, 'packages/conversations/src/index.ts'), 'utf8') + readFileSync(join(root, 'packages/conversations/src/limits.ts'), 'utf8')
      + readFileSync(join(root, 'packages/conversations/src/files/errors.ts'), 'utf8');
    expect(src).not.toMatch(/from '(node:crypto|knex|next\/[^']*|@alga-psa\/(db|storage)[^']*)'/);
  });
  it('no mounted route and no import from server/src/app', () => {
    const files = walk(join(root, 'server/src/app')).filter(f => /route\.tsx?$/.test(f));
    for (const f of files) expect(readFileSync(f, 'utf8'), f).not.toContain('@alga-psa/conversations');
  });
});
