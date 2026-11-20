import { execFileSync } from 'child_process';
import { describe, expect, it, vi } from 'vitest';

const fromPath = vi.hoisted(() => vi.fn());
vi.mock('pdf2pic', () => ({ fromPath }));

import { renderPdfPages } from './pdfPageRender';

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
    let failed = false;
    try {
      execFileSync('gs', ['-q', '-dBATCH', '-dNODISPLAY', '-c', '(/etc/hostname) (r) file closefile quit'], { stdio: 'pipe' });
    } catch (error) {
      failed = /invalidfileaccess/.test(String((error as { stdout?: Buffer }).stdout));
    }
    expect(failed).toBe(true);
  });
});
