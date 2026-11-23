import { execFileSync, spawnSync } from 'child_process';
import { randomUUID } from 'crypto';
import { existsSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { describe, expect, it, vi } from 'vitest';

const fromPath = vi.hoisted(() => vi.fn());
vi.mock('pdf2pic', () => ({ fromPath }));

const missing = vi.hoisted(() => ({ value: false }));
vi.mock('./graphicsMagickProbe', async (orig) => ({
  ...(await orig<typeof import('./graphicsMagickProbe')>()),
  isGraphicsMagickMissing: vi.fn(async () => missing.value),
}));

import { PdfRendererMissingError, renderPdfPages } from './pdfPageRender';

const convert = (impl: (page: number) => Promise<unknown>) => fromPath.mockReturnValue((page: number) => impl(page));

describe('renderPdfPages', () => {
  it('renders pages one at a time, fitting a square box when maxEdgePx is given', async () => {
    convert(async (page) => ({ buffer: Buffer.from(`p${page}`) }));
    const out = await renderPdfPages('/tmp/x.pdf', [2, 5], { dpi: 150, maxEdgePx: 1568, timeoutMs: 1000, saveDir: '/tmp' });
    expect(out.map((o) => [o.page, o.buffer.toString()])).toEqual([[2, 'p2'], [5, 'p5']]);
    expect(fromPath).toHaveBeenCalledWith('/tmp/x.pdf', expect.objectContaining({ density: 150, width: 1568, height: 1568, preserveAspectRatio: true, format: 'png', savePath: '/tmp' }));
  });

  it('uses the exact box (and no aspect-ratio flag) for the preview path', async () => {
    convert(async () => ({ buffer: Buffer.from('x') }));
    await renderPdfPages('/tmp/x.pdf', [1], { dpi: 150, width: 1200, height: 1600, timeoutMs: 1000, saveDir: '/tmp' });
    const opts = fromPath.mock.calls.at(-1)![1];
    expect(opts).toMatchObject({ width: 1200, height: 1600 });
    expect('preserveAspectRatio' in opts).toBe(false);
  });

  it('times out ONE page render with an ordinary Error', async () => {
    convert(() => new Promise(() => undefined));
    await expect(renderPdfPages('/tmp/x.pdf', [1], { dpi: 72, maxEdgePx: 100, timeoutMs: 20, saveDir: '/tmp' })).rejects.toThrow('PDF render timed out after 20ms');
  });

  it('rejects when nothing was produced', async () => {
    convert(async () => ({}));
    await expect(renderPdfPages('/tmp/x.pdf', [1], { dpi: 72, maxEdgePx: 100, timeoutMs: 100, saveDir: '/tmp' })).rejects.toThrow('Failed to render PDF page');
  });
});

describe('missing renderer diagnostics', () => {
  it('names GraphicsMagick when the render fails and gm is not installed (error or hang)', async () => {
    missing.value = true;
    try {
      convert(async () => {
        throw new Error('spawn gm ENOENT');
      });
      await expect(renderPdfPages('/tmp/x.pdf', [1], { dpi: 72, maxEdgePx: 100, timeoutMs: 100, saveDir: '/tmp' })).rejects.toThrow(PdfRendererMissingError);
      convert(() => new Promise(() => undefined));
      await expect(renderPdfPages('/tmp/x.pdf', [1], { dpi: 72, maxEdgePx: 100, timeoutMs: 20, saveDir: '/tmp' })).rejects.toThrow(/GraphicsMagick \(gm\) is not installed/);
    } finally {
      missing.value = false;
    }
  });
});

describe('Ghostscript hardening (R3)', () => {
  const gs = (() => {
    try {
      execFileSync('gs', ['--version'], { stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
  })();

  it.skipIf(!gs)('refuses file access from PostScript by default (SAFER is the default since 9.50)', () => {
    const logPath = join(tmpdir(), `gs-refusal-${randomUUID()}.log`);
    try {
      const result = spawnSync('gs', [`-sstdout=${logPath}`, '-dBATCH', '-dNODISPLAY', '-c', '(/etc/hostname) (r) file closefile quit'], { encoding: 'utf8' });
      expect(result.status).not.toBe(0);
      expect(existsSync(logPath)).toBe(true);
      expect(readFileSync(logPath, 'utf8')).toMatch(/invalidfileaccess/);
    } finally {
      rmSync(logPath, { force: true });
    }
  });
});
