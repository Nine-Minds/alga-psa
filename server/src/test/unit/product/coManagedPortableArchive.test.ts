import { afterEach, describe, expect, it } from 'vitest';
import { createCipheriv, createDecipheriv, createHash, randomUUID, scryptSync } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { openPortableArchive, sealPortableArchive, PORTABLE_ARCHIVE_LIMITS } from '../../../../../packages/co-managed/src/portableArchive';
const PASSPHRASE = 'Exact customer-owned recovery passphrase 2026';
const MAGIC = Buffer.from('ALGA-WORKSPACE-ARCHIVE\0\x01', 'binary'), HEADER = MAGIC.length + 24;
const MESSAGE = 'Portable archive is invalid or cannot be unlocked.';
const roots: string[] = [], previousTmp = process.env.TMPDIR;
afterEach(async () => { if (previousTmp === undefined) delete process.env.TMPDIR; else process.env.TMPDIR = previousTmp;
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
async function fixture(size = 32) {
  const root = await mkdtemp(join(tmpdir(), 'portable-archive-test-')); roots.push(root); process.env.TMPDIR = root;
  const bytes = Buffer.alloc(size, 0x6d), path = join(root, 'source.bin'); await writeFile(path, bytes, { mode: 0o600 });
  const file = { id: `file:${randomUUID()}`, path, size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
  const context = { packageId: randomUUID(), sourceTenant: randomUUID() };
  const manifest = { packageId: context.packageId, sourceTenant: context.sourceTenant, workflow: { literal: 'secret authored workflow value', unicode: 'é東京😀\ud800', escaped: '\"\\\n\u0001' }, records: [] };
  const directories = async () => (await readdir(root)).filter(name => name.startsWith('alga-portable-archive-'));
  return { root, bytes, file, context, manifest, directories, seal: () => sealPortableArchive({ context, manifest, files: [file] }, PASSPHRASE) };
}

describe('portable encrypted archive transport', () => {
  it('round trips an authenticated manifest and actual files across a frame boundary using only the customer passphrase', async () => {
    const f = await fixture(PORTABLE_ARCHIVE_LIMITS.frameBytes + 13);
    const emptyPath = join(f.root, 'empty.bin'); await writeFile(emptyPath, Buffer.alloc(0));
    const empty = { id: `attachment:${randomUUID()}`, path: emptyPath, size: 0, sha256: createHash('sha256').digest('hex') };
    const sealed = await sealPortableArchive({ context: f.context, manifest: f.manifest, files: [f.file, empty] }, PASSPHRASE);
    let opened: Awaited<ReturnType<typeof openPortableArchive>> | undefined;
    try {
      expect((await stat(sealed.path)).mode & 0o777).toBe(0o600);
      expect((await stat(dirname(sealed.path))).mode & 0o777).toBe(0o700);
      const wire = await readFile(sealed.path);
      expect(wire.includes(Buffer.from('secret authored workflow value'))).toBe(false);
      expect(wire.includes(Buffer.from(f.file.id))).toBe(false);
      expect(sealed.sha256).toBe(createHash('sha256').update(wire).digest('hex'));
      opened = await openPortableArchive(sealed.path, PASSPHRASE, f.context);
      expect(opened.context).toEqual(f.context); expect(opened.manifest).toEqual(f.manifest);
      expect(opened.files.map(file => file.id)).toEqual([f.file.id, empty.id]);
      expect((await readFile(opened.files[0].path)).equals(f.bytes)).toBe(true); expect(await readFile(opened.files[1].path)).toEqual(Buffer.alloc(0));
      for (const file of opened.files) expect((await stat(file.path)).mode & 0o777).toBe(0o600);
    } finally { await opened?.dispose(); await sealed.dispose(); }
    expect(await f.directories()).toEqual([]);
  });

  it('rejects wrong passphrases, context substitution, modified bytes, reordered or duplicated frames, truncation and appended content before returning a lease', async () => {
    const f = await fixture(PORTABLE_ARCHIVE_LIMITS.frameBytes + 29), sealed = await f.seal();
    try {
      const wire = await readFile(sealed.path), firstEnd = HEADER + 21 + wire.readUInt32BE(HEADER + 1);
      const secondEnd = firstEnd + 21 + wire.readUInt32BE(firstEnd + 1);
      const changedManifest = Buffer.from(wire); changedManifest[HEADER + 15] ^= 1;
      const changedBlob = Buffer.from(wire); changedBlob[firstEnd + 10] ^= 1;
      const changedLength = Buffer.from(wire); changedLength.writeUInt32BE(PORTABLE_ARCHIVE_LIMITS.frameBytes + 1, HEADER + 1);
      const reordered = Buffer.concat([wire.subarray(0, HEADER), wire.subarray(firstEnd, secondEnd), wire.subarray(HEADER, firstEnd), wire.subarray(secondEnd)]);
      const duplicated = Buffer.concat([wire.subarray(0, firstEnd), wire.subarray(HEADER, firstEnd), wire.subarray(firstEnd)]);
      const other = await sealPortableArchive({ context: { ...f.context, packageId: randomUUID() }, manifest: f.manifest, files: [f.file] }, PASSPHRASE);
      let substituted: Buffer;
      try { substituted = Buffer.concat([wire.subarray(0, HEADER), (await readFile(other.path)).subarray(HEADER)]); } finally { await other.dispose(); }
      const variants = [changedManifest, changedBlob, changedLength, reordered, duplicated, substituted!, wire.subarray(0, wire.length - 1), wire.subarray(0, secondEnd), Buffer.concat([wire, Buffer.from([1])])];
      await expect(openPortableArchive(sealed.path, `${PASSPHRASE} wrong`)).rejects.toThrow(MESSAGE);
      await expect(openPortableArchive(sealed.path, PASSPHRASE, { ...f.context, sourceTenant: randomUUID() })).rejects.toThrow(MESSAGE);
      for (let index = 0; index < variants.length; index++) {
        const path = join(f.root, `corrupt-${index}.alga`); await writeFile(path, variants[index]);
        await expect(openPortableArchive(path, PASSPHRASE)).rejects.toThrow(MESSAGE);
        expect(await f.directories()).toHaveLength(1);
      }
    } finally { await sealed.dispose(); }
    expect(await f.directories()).toEqual([]);
  });

  it('rejects authenticated but inconsistent blob checksums and cleans up after extraction failure', async () => {
    const f = await fixture(), sealed = await f.seal();
    try {
      const wire = await readFile(sealed.path), header = wire.subarray(0, HEADER), length = wire.readUInt32BE(HEADER + 1);
      const frame = wire.subarray(HEADER, HEADER + 5), counter = Buffer.alloc(4);
      const key = scryptSync(PASSPHRASE, header.subarray(MAGIC.length, MAGIC.length + 16), 32, { N: 131072, r: 8, p: 1, maxmem: 256 * 1024 * 1024 });
      try {
        const nonce = Buffer.concat([header.subarray(HEADER - 8), counter]), aad = Buffer.concat([header, counter, frame]);
        const decipher = createDecipheriv('aes-256-gcm', key, nonce); decipher.setAAD(aad); decipher.setAuthTag(wire.subarray(HEADER + 5 + length, HEADER + 21 + length));
        const plain = Buffer.concat([decipher.update(wire.subarray(HEADER + 5, HEADER + 5 + length)), decipher.final()]);
        const metadataLength = plain.readUInt32BE(0), metadata = JSON.parse(plain.subarray(4, 4 + metadataLength).toString('utf8'));
        metadata.blobs[0].sha256 = '0'.repeat(64); Buffer.from(JSON.stringify(metadata)).copy(plain, 4);
        const cipher = createCipheriv('aes-256-gcm', key, nonce); cipher.setAAD(aad);
        const rewritten = Buffer.concat([header, frame, cipher.update(plain), cipher.final(), cipher.getAuthTag(), wire.subarray(HEADER + 21 + length)]);
        plain.fill(0);
        const path = join(f.root, 'authenticated-wrong-hash.alga'); await writeFile(path, rewritten);
        await expect(openPortableArchive(path, PASSPHRASE)).rejects.toThrow(MESSAGE); expect(await f.directories()).toHaveLength(1);
      } finally { key.fill(0); }
    } finally { await sealed.dispose(); }
    expect(await f.directories()).toEqual([]);
  });

  it('rejects unsafe identities, duplicate membership, oversized files, symlinks and source hash changes without partial output', async () => {
    const f = await fixture();
    for (const files of [[{ ...f.file, id: '../../escape' }], [{ ...f.file, id: f.file.id.toUpperCase() }], [f.file, f.file], [{ ...f.file, size: PORTABLE_ARCHIVE_LIMITS.blobBytes + 1 }]]) {
      await expect(sealPortableArchive({ context: f.context, manifest: f.manifest, files }, PASSPHRASE)).rejects.toThrow(MESSAGE);
      expect(await f.directories()).toEqual([]);
    }
    let accessed = false;
    const accessor = Object.defineProperty({}, 'payload', { enumerable: true, get() { accessed = true; return 'never execute'; } });
    await expect(sealPortableArchive({ context: f.context, manifest: accessor, files: [] }, PASSPHRASE)).rejects.toThrow(MESSAGE);
    expect(accessed).toBe(false);
    const sparse: unknown[] = []; sparse.length = 100_000_000;
    await expect(sealPortableArchive({ context: f.context, manifest: { sparse }, files: [] }, PASSPHRASE)).rejects.toThrow(MESSAGE);
    const link = join(f.root, 'source-link'); await symlink(f.file.path, link);
    await expect(sealPortableArchive({ context: f.context, manifest: f.manifest, files: [{ ...f.file, path: link }] }, PASSPHRASE)).rejects.toThrow(MESSAGE);
    await writeFile(f.file.path, Buffer.alloc(f.file.size, 0x41)); await expect(f.seal()).rejects.toThrow(MESSAGE);
    expect(await f.directories()).toEqual([]);
  });
});
