import { describe, expect, it, vi } from 'vitest';
import {
  SQUARE_MARK_DIMENSION,
  parseLogoCrop,
  renderSquareMark,
  resolveCropPixels,
  type SharpLike,
  type SharpPipelineLike,
} from '../src/imageCrop';

describe('parseLogoCrop', () => {
  it('treats a missing field as no crop', () => {
    expect(parseLogoCrop(null)).toBeNull();
    expect(parseLogoCrop(undefined)).toBeNull();
    expect(parseLogoCrop('')).toBeNull();
  });

  it('accepts the JSON form field the upload sends', () => {
    expect(parseLogoCrop(JSON.stringify({ x: 0.1, y: 0, width: 0.25, height: 1 })))
      .toEqual({ x: 0.1, y: 0, width: 0.25, height: 1 });
  });

  it('accepts a zone that reaches past the image, as long as it overlaps it', () => {
    // Zoomed out on a 4:1 wordmark: the square is twice the image's height.
    expect(parseLogoCrop('{"x":0.7,"y":-0.5,"width":0.5,"height":2}'))
      .toEqual({ x: 0.7, y: -0.5, width: 0.5, height: 2 });
  });

  it('rejects zones that miss the image, have no area, or are absurd', () => {
    expect(() => parseLogoCrop('{"x":1,"y":0,"width":0.25,"height":1}')).toThrow(/overlap the image/);
    expect(() => parseLogoCrop('{"x":-0.5,"y":0,"width":0.5,"height":1}')).toThrow(/overlap the image/);
    expect(() => parseLogoCrop('{"x":0,"y":0,"width":0,"height":1}')).toThrow(/non-empty/);
    expect(() => parseLogoCrop('{"x":0,"y":0,"width":50,"height":1}')).toThrow(/fractions/);
    expect(() => parseLogoCrop('{"x":"0","y":0,"width":1,"height":1}')).toThrow(/fractions/);
    expect(() => parseLogoCrop('not json')).toThrow(/JSON/);
    expect(() => parseLogoCrop('[1,2]')).toThrow();
  });
});

describe('resolveCropPixels', () => {
  it('maps a zone inside the image straight onto its pixels', () => {
    expect(resolveCropPixels({ x: 0.1, y: 0, width: 0.25, height: 1 }, 1000, 250)).toEqual({
      region: { left: 100, top: 0, width: 250, height: 250 },
      extend: { left: 0, top: 0, right: 0, bottom: 0 },
    });
  });

  it('turns overhang into padding and shifts the region onto the padded canvas', () => {
    // The square hangs 25px past the right edge and 125px above and below.
    expect(resolveCropPixels({ x: 0.65, y: -0.5, width: 0.5, height: 2 }, 1000, 250)).toEqual({
      region: { left: 650, top: 0, width: 500, height: 500 },
      extend: { left: 0, top: 125, right: 150, bottom: 125 },
    });
    expect(resolveCropPixels({ x: -0.1, y: 0, width: 0.35, height: 1 }, 1000, 250)).toEqual({
      region: { left: 0, top: 0, width: 350, height: 250 },
      extend: { left: 100, top: 0, right: 0, bottom: 0 },
    });
  });

  it('never lets rounding produce an empty region', () => {
    expect(resolveCropPixels({ x: 0.999, y: 0.999, width: 0.01, height: 0.01 }, 10, 10).region)
      .toEqual({ left: 10, top: 10, width: 1, height: 1 });
  });
});

const pipeline = (meta: { width?: number; height?: number; orientation?: number }) => {
  const calls: Record<string, unknown[]> = {};
  const p: SharpPipelineLike = {
    metadata: vi.fn(async () => meta),
    rotate: vi.fn(() => { calls.rotate = []; return p; }),
    ensureAlpha: vi.fn(() => { calls.ensureAlpha = []; return p; }),
    extend: vi.fn((o) => { calls.extend = [o]; return p; }),
    png: vi.fn(() => { calls.png = []; return p; }),
    extract: vi.fn((region) => { calls.extract = [region]; return p; }),
    resize: vi.fn((w, h, o) => { calls.resize = [w, h, o]; return p; }),
    webp: vi.fn((o) => { calls.webp = [o]; return p; }),
    toBuffer: vi.fn(async () => Buffer.from(calls.png ? 'padded' : 'mark')),
  };
  return { p, calls };
};

describe('renderSquareMark', () => {
  it('orients, cuts the chosen zone and renders it at avatar size', async () => {
    const { p, calls } = pipeline({ width: 1000, height: 250 });
    const sharp = vi.fn(() => p) as unknown as SharpLike;

    const out = await renderSquareMark(sharp, Buffer.from('png'), { x: 0.1, y: 0, width: 0.25, height: 1 }, false);

    expect(out.toString()).toBe('mark');
    expect(sharp).toHaveBeenCalledTimes(1);
    expect(calls.extract).toEqual([{ left: 100, top: 0, width: 250, height: 250 }]);
    expect(calls.resize).toEqual([SQUARE_MARK_DIMENSION, SQUARE_MARK_DIMENSION, { fit: 'cover' }]);
    expect(calls.webp).toEqual([{ quality: 85 }]);
    expect(p.rotate).toHaveBeenCalled();
    expect(p.extend).not.toHaveBeenCalled();
  });

  it('pads a zone that reaches past the image with transparency before cutting', async () => {
    const original = pipeline({ width: 1000, height: 250 });
    const padded = pipeline({ width: 1150, height: 500 });
    const sharp = vi.fn((buf: Buffer) => (buf.toString() === 'padded' ? padded.p : original.p)) as unknown as SharpLike;

    await renderSquareMark(sharp, Buffer.from('png'), { x: 0.65, y: -0.5, width: 0.5, height: 2 }, false);

    expect(original.calls.extend).toEqual([{ left: 0, top: 125, right: 150, bottom: 125, background: { r: 0, g: 0, b: 0, alpha: 0 } }]);
    expect(original.p.ensureAlpha).toHaveBeenCalled();
    expect(original.p.png).toHaveBeenCalled();
    expect(original.p.extract).not.toHaveBeenCalled();
    expect(padded.calls.extract).toEqual([{ left: 650, top: 0, width: 500, height: 500 }]);
    expect(padded.calls.resize).toEqual([SQUARE_MARK_DIMENSION, SQUARE_MARK_DIMENSION, { fit: 'cover' }]);
  });

  it('swaps the measured dimensions for EXIF orientations that rotate 90 degrees', async () => {
    // Stored 250x1000 portrait, displayed 1000x250 after orientation 6.
    const { p, calls } = pipeline({ width: 250, height: 1000, orientation: 6 });
    const sharp = vi.fn(() => p) as unknown as SharpLike;

    await renderSquareMark(sharp, Buffer.from('jpg'), { x: 0.5, y: 0, width: 0.25, height: 1 }, false);

    expect(calls.extract).toEqual([{ left: 500, top: 0, width: 250, height: 250 }]);
  });

  it('rasterizes an SVG large enough for the mark to stay crisp', async () => {
    const intrinsic = pipeline({ width: 200, height: 50 });
    const rendered = pipeline({ width: 1024, height: 256 });
    const sharp = vi.fn((_buf: Buffer, options?: { density?: number }) =>
      options?.density ? rendered.p : intrinsic.p) as unknown as SharpLike;

    await renderSquareMark(sharp, Buffer.from('<svg/>'), { x: 0, y: 0, width: 0.25, height: 1 }, true);

    // 72dpi * (1024 / 200) rounds to 369.
    expect(sharp).toHaveBeenLastCalledWith(expect.any(Buffer), { density: 369 });
    expect(rendered.calls.extract).toEqual([{ left: 0, top: 0, width: 256, height: 256 }]);
  });

  it('fails clearly when the image has no readable dimensions', async () => {
    const { p } = pipeline({});
    const sharp = vi.fn(() => p) as unknown as SharpLike;
    await expect(renderSquareMark(sharp, Buffer.from('x'), { x: 0, y: 0, width: 1, height: 1 }, false))
      .rejects.toThrow(/dimensions/);
  });
});
