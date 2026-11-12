import { beforeEach, describe, expect, it, vi } from 'vitest';
import { spawnSync } from 'child_process';
import fs, { mkdtempSync, rmSync } from 'fs';
import os from 'os';
import path from 'path';
import { Readable } from 'stream';

/**
 * generatePreviewsForDocument against an in-memory documents/external_files store and the real
 * sharp/ffmpeg. Covers: derivatives never alias the original, the source is streamed from storage,
 * a retried job leaves exactly one thumbnail and one preview, and the video path works for an MP4
 * whose moov atom is at the end.
 */
type Row = Record<string, any>;
const TENANT = 'tenant-1';
const DOC = 'doc-1';
const ORIGINAL = 'original-file-id';

const h = vi.hoisted(() => ({
  // Read once at module load: keep the pdf2pic timeout test fast.
  _env: (process.env.DOCUMENT_PREVIEW_PDF_RENDER_TIMEOUT_MS = '50'),
  documents: [] as Array<Record<string, any>>,
  files: [] as Array<Record<string, any>>,
  uploads: [] as Array<{ name: string; options: any; bytes: number }>,
  deleted: [] as string[],
  source: { stream: () => null as unknown as Readable, seekable: null as any },
  published: [] as Array<{ eventType: string }>,
  streamRequests: 0,
  seq: 0,
}));

class FakeQuery {
  private filters: Array<(row: Row) => boolean> = [];
  private patch: Row | null = null;
  constructor(private readonly rows: Row[]) {}
  where(cond: Row) {
    this.filters.push((row) => Object.entries(cond).every(([k, v]) => row[k] === v));
    return this;
  }
  whereIn(column: string, values: unknown[]) {
    this.filters.push((row) => values.includes(row[column]));
    return this;
  }
  whereRaw(sql: string, bindings: unknown[]) {
    if (sql.includes("source_document_id")) {
      this.filters.push((row) => row.metadata?.source_document_id === bindings[0]);
    } else if (sql.includes("context")) {
      this.filters.push((row) => ['document_thumbnail', 'document_preview'].includes(row.metadata?.context));
    }
    return this;
  }
  forUpdate() { return this; }
  private matched() { return this.rows.filter((row) => this.filters.every((f) => f(row))); }
  async first() { const row = this.matched()[0]; return row ? { ...row } : row; }
  async select() { return this.matched(); }
  update(patch: Row) { this.patch = patch; return this; }
  then(resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) {
    const run = async () => {
      const matched = this.matched();
      if (this.patch) matched.forEach((row) => Object.assign(row, this.patch));
      return this.patch ? matched.length : matched;
    };
    return run().then(resolve, reject);
  }
}

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: async () => ({ knex: {}, tenant: 'tenant-1' }),
  withTransaction: async (_knex: unknown, cb: (trx: unknown) => unknown) => cb({}),
  tenantDb: () => ({
    table: (name: string) => new FakeQuery(name === 'documents' ? h.documents : h.files),
  }),
}));

vi.mock('@alga-psa/storage/StorageService', () => {
  class StorageService {
    async getFileReadStream() {
      h.streamRequests += 1;
      return h.source.stream();
    }
    static async getSeekableInput() { return h.source.seekable; }
    static async uploadFile(_tenant: string, buffer: Buffer, name: string, options: any) {
      const file_id = `derived-${++h.seq}`;
      h.uploads.push({ name, options, bytes: buffer.length });
      h.files.push({ tenant: 'tenant-1', file_id, is_deleted: false, metadata: options.metadata, mime_type: 'image/jpeg' });
      return { file_id };
    }
    static async deleteFile(fileId: string) {
      h.deleted.push(fileId);
      const row = h.files.find((f) => f.file_id === fileId);
      if (row) row.is_deleted = true;
    }
  }
  return { StorageService };
});
vi.mock('@alga-psa/event-bus/publishers', () => ({
  publishWorkflowEvent: async (event: { eventType: string }) => { h.published.push(event); },
}));
vi.mock('@alga-psa/validation', () => ({ isValidUUID: () => true }));
vi.mock('@alga-psa/workflow-streams', () => ({
  buildMediaProcessingFailedPayload: (p: unknown) => p,
  buildMediaProcessingSucceededPayload: (p: unknown) => p,
}));
vi.mock('pdf2pic', () => ({ fromPath: vi.fn() }));
vi.mock('./documentPreviewProvenance', () => ({
  validateDocumentPreviewProvenance: async (_k: unknown, _t: string, documentId: string, refs: Row) => {
    for (const id of [refs.thumbnail_file_id, refs.preview_file_id].filter(Boolean)) {
      const row = h.files.find((f) => f.file_id === id && !f.is_deleted);
      if (row?.metadata?.source_document_id !== documentId) throw new Error(`bad provenance ${id}`);
    }
  },
}));

async function pngBytes(width = 400, height = 300) {
  const sharp = (await import('sharp')).default;
  return sharp({ create: { width, height, channels: 3, background: { r: 200, g: 30, b: 30 } } }).png().toBuffer();
}

function seedDocument(mime: string, extra: Row = {}) {
  h.documents.push({
    tenant: TENANT, document_id: DOC, file_id: ORIGINAL, mime_type: mime, created_by: 'user-1',
    thumbnail_file_id: null, preview_file_id: null, preview_generated_at: null, ...extra,
  });
  h.files.push({ tenant: TENANT, file_id: ORIGINAL, is_deleted: false, mime_type: mime, file_size: 1000, metadata: {} });
}

const derivatives = () => h.files.filter((f) => f.file_id !== ORIGINAL && !f.is_deleted);

describe('generatePreviewsForDocument', () => {
  beforeEach(() => {
    h.documents.length = 0; h.files.length = 0; h.uploads.length = 0; h.deleted.length = 0;
    h.published.length = 0; h.streamRequests = 0; h.seq = 0;
  });

  it('streams an image from storage and stores distinct JPEG derivatives', async () => {
    seedDocument('image/png');
    const png = await pngBytes();
    h.source.stream = () => Readable.from([png.subarray(0, 100), png.subarray(100)]);
    const { generatePreviewsForDocument } = await import('./documentPreviewGenerator');

    const r = await generatePreviewsForDocument(DOC);

    expect(h.streamRequests).toBe(1);
    expect(r.thumbnail_file_id).toMatch(/^derived-/);
    expect(r.preview_file_id).toMatch(/^derived-/);
    expect(r.preview_file_id).not.toBe(ORIGINAL);
    expect(h.uploads.map((u) => u.options)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ mime_type: 'image/jpeg', origin: 'system-artifact', isDerivedArtifact: true }),
      ]),
    );
    expect(h.documents[0]).toMatchObject({
      thumbnail_file_id: r.thumbnail_file_id,
      preview_file_id: r.preview_file_id,
    });
    expect(h.published.map((e) => e.eventType)).toEqual(['MEDIA_PROCESSING_SUCCEEDED']);
  });

  it('an SVG original is never aliased: the preview is a re-encoded JPEG derivative', async () => {
    seedDocument('image/svg+xml');
    h.source.stream = () =>
      Readable.from([Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10" fill="red"/></svg>')]);
    const { generatePreviewsForDocument } = await import('./documentPreviewGenerator');

    const r = await generatePreviewsForDocument(DOC);

    expect(r.preview_file_id).not.toBe(ORIGINAL);
    expect(r.preview_file_id).toMatch(/^derived-/);
  });

  it('running the job twice leaves exactly one thumbnail and one preview row', async () => {
    seedDocument('image/png');
    const png = await pngBytes();
    h.source.stream = () => Readable.from([png]);
    const { generatePreviewsForDocument } = await import('./documentPreviewGenerator');

    const first = await generatePreviewsForDocument(DOC);
    const second = await generatePreviewsForDocument(DOC);

    const live = derivatives();
    expect(live.filter((f) => f.metadata.context === 'document_thumbnail')).toHaveLength(1);
    expect(live.filter((f) => f.metadata.context === 'document_preview')).toHaveLength(1);
    // The document points at the surviving rows, and the first run's rows were replaced.
    expect(h.documents[0].thumbnail_file_id).toBe(second.thumbnail_file_id);
    expect(h.documents[0].preview_file_id).toBe(second.preview_file_id);
    expect(h.deleted.sort()).toEqual([first.thumbnail_file_id, first.preview_file_id].sort());
  });

  it('a retry after a crash that left orphaned derivatives cleans them up', async () => {
    seedDocument('image/png');
    // Run 1 uploaded both files but died before updating the document row.
    for (const [id, context] of [['orphan-t', 'document_thumbnail'], ['orphan-p', 'document_preview']]) {
      h.files.push({ tenant: TENANT, file_id: id, is_deleted: false, metadata: { context, source_document_id: DOC } });
    }
    const png = await pngBytes();
    h.source.stream = () => Readable.from([png]);
    const { generatePreviewsForDocument } = await import('./documentPreviewGenerator');

    await generatePreviewsForDocument(DOC);

    expect(derivatives()).toHaveLength(2);
    expect(derivatives().map((f) => f.file_id)).not.toContain('orphan-t');
  });

  it('discards its output when the document file changed while it ran', async () => {
    seedDocument('image/png');
    const png = await pngBytes();
    h.source.stream = () => {
      h.documents[0].file_id = 'replacement-file'; // replaceDocumentFile commits mid-job
      return Readable.from([png]);
    };
    const { generatePreviewsForDocument } = await import('./documentPreviewGenerator');

    const r = await generatePreviewsForDocument(DOC);

    expect(r.thumbnail_file_id).toBeNull();
    expect(derivatives()).toHaveLength(0);
    expect(h.documents[0].thumbnail_file_id).toBeNull();
    expect(h.published).toHaveLength(0);
  });

  it('publishes MEDIA_PROCESSING_FAILED and rethrows when the source is unreadable', async () => {
    seedDocument('image/png');
    h.source.stream = () => Readable.from([Buffer.from('definitely not an image')]);
    const { generatePreviewsForDocument } = await import('./documentPreviewGenerator');

    await expect(generatePreviewsForDocument(DOC)).rejects.toThrow();

    expect(h.published.map((e) => e.eventType)).toEqual(['MEDIA_PROCESSING_FAILED']);
    expect(derivatives()).toHaveLength(0);
  });

  it('returns empty ids without reading storage for unsupported types and missing documents', async () => {
    seedDocument('text/plain');
    const { generatePreviewsForDocument } = await import('./documentPreviewGenerator');

    expect((await generatePreviewsForDocument(DOC)).thumbnail_file_id).toBeNull();
    expect((await generatePreviewsForDocument('missing-doc')).thumbnail_file_id).toBeNull();
    expect(h.streamRequests).toBe(0);
  });

  it('skips (no failure) a PDF over the size cap without reading it', async () => {
    seedDocument('application/pdf');
    h.files.find((f) => f.file_id === ORIGINAL)!.file_size = 10 * 1024 * 1024 * 1024;
    const { generatePreviewsForDocument } = await import('./documentPreviewGenerator');

    const r = await generatePreviewsForDocument(DOC);

    expect(r.preview_file_id).toBeNull();
    expect(h.streamRequests).toBe(0);
    expect(h.published).toHaveLength(0);
  });

  it('a hung pdf2pic render times out, fails the job (retryable) and removes the temp PDF', async () => {
    seedDocument('application/pdf');
    h.source.stream = () => Readable.from([Buffer.from('%PDF-1.4 fake')]);
    const pdf2pic = await import('pdf2pic');
    let renderedFrom = '';
    (pdf2pic.fromPath as any).mockImplementation((p: string) => {
      renderedFrom = p;
      return () => new Promise(() => undefined); // Ghostscript never returns
    });
    const { generatePreviewsForDocument, PDF_RENDER_TIMEOUT_MS } = await import('./documentPreviewGenerator');
    expect(PDF_RENDER_TIMEOUT_MS).toBe(50);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await expect(generatePreviewsForDocument(DOC)).rejects.toThrow(/PDF render timed out/);

    expect(h.published.map((e) => e.eventType)).toEqual(['MEDIA_PROCESSING_FAILED']);
    expect(h.published[0]).toMatchObject({ payload: { retryable: true } });
    expect(renderedFrom).not.toBe('');
    expect(fs.existsSync(renderedFrom)).toBe(false);
    expect(fs.existsSync(path.dirname(renderedFrom))).toBe(false);
  });

  const ffmpegAvailable = spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).status === 0;
  it.skipIf(!ffmpegAvailable)('video: ffmpeg seeks a file whose moov atom is at the end', async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'preview-test-'));
    try {
      const video = path.join(dir, 'moov-at-end.mp4');
      // No +faststart: the muxer writes the moov atom after mdat.
      const made = spawnSync('ffmpeg', [
        '-v', 'error', '-f', 'lavfi', '-i', 'testsrc=duration=3:size=320x240:rate=10',
        '-c:v', 'mpeg4', '-movflags', '-faststart', '-y', video,
      ]);
      expect(made.status).toBe(0);

      seedDocument('video/mp4');
      h.source.seekable = { kind: 'file', path: video };
      const { generatePreviewsForDocument } = await import('./documentPreviewGenerator');

      const r = await generatePreviewsForDocument(DOC);

      expect(h.streamRequests).toBe(0); // the video never went through a Node stream
      expect(r.thumbnail_file_id).toMatch(/^derived-/);
      expect(h.uploads.every((u) => u.options.metadata.source_type === 'video')).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it.skipIf(!ffmpegAvailable)('video: a clip shorter than one second falls back to the first frame', async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'preview-test-'));
    try {
      const video = path.join(dir, 'short.mp4');
      const made = spawnSync('ffmpeg', [
        '-v', 'error', '-f', 'lavfi', '-i', 'testsrc=duration=0.4:size=320x240:rate=10',
        '-c:v', 'mpeg4', '-y', video,
      ]);
      expect(made.status).toBe(0);

      seedDocument('video/mp4');
      h.source.seekable = { kind: 'file', path: video };
      const { generatePreviewsForDocument } = await import('./documentPreviewGenerator');

      const r = await generatePreviewsForDocument(DOC);

      expect(r.thumbnail_file_id).toMatch(/^derived-/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
