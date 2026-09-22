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

  it('rejects zones outside the image or without area', () => {
    expect(() => parseLogoCrop('{"x":0.9,"y":0,"width":0.25,"height":1}')).toThrow(/inside the image/);
    expect(() => parseLogoCrop('{"x":0,"y":0,"width":0,"height":1}')).toThrow(/non-empty/);
    expect(() => parseLogoCrop('{"x":"0","y":0,"width":1,"height":1}')).toThrow(/fractions/);
    expect(() => parseLogoCrop('not json')).toThrow(/JSON/);
    expect(() => parseLogoCrop('[1,2]')).toThrow();
  });
});

describe('resolveCropPixels', () => {
  it('maps fractions onto the image and keeps the region inside it', () => {
    expect(resolveCropPixels({ x: 0.1, y: 0, width: 0.25, height: 1 }, 1000, 250))
      .toEqual({ left: 100, top: 0, width: 250, height: 250 });
  });

  it('never lets rounding push the region past the edge', () => {
    // 0.7499 * 1000 rounds to 750; a full-height square of 250 would end at 1000 exactly.
    expect(resolveCropPixels({ x: 0.7505, y: 0, width: 0.2505, height: 1 }, 1000, 250))
      .toEqual({ left: 751, top: 0, width: 249, height: 250 });
    expect(resolveCropPixels({ x: 0.999, y: 0.999, width: 0.5, height: 0.5 }, 10, 10))
      .toEqual({ left: 9, top: 9, width: 1, height: 1 });
  });
});

const pipeline = (meta: { width?: number; height?: number; orientation?: number }) => {
  const calls: Record<string, unknown[]> = {};
  const p: SharpPipelineLike = {
    metadata: vi.fn(async () => meta),
    rotate: vi.fn(() => { calls.rotate = []; return p; }),
    extract: vi.fn((region) => { calls.extract = [region]; return p; }),
    resize: vi.fn((w, h, o) => { calls.resize = [w, h, o]; return p; }),
    webp: vi.fn((o) => { calls.webp = [o]; return p; }),
    toBuffer: vi.fn(async () => Buffer.from('mark')),
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
