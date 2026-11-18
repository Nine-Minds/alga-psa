import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import * as F from './__fixtures__/build';
import { fileSource } from './__fixtures__/sources';
import { DEFAULT_BUDGET, readAttachmentContent } from './index';

const read = (sources: ReturnType<typeof fileSource>[]) => readAttachmentContent(sources, { docIndex: 0, unitIndex: 0 }, DEFAULT_BUDGET);
const imageBlock = (r: Awaited<ReturnType<typeof read>>) => r.blocks.find((b) => b.type === 'image') as { type: 'image'; data: string; mimeType: string };

describe('image producer', () => {
  it('passes a small PNG through unchanged', async () => {
    const bytes = await F.png(100, 80);
    const r = await read([fileSource('small.png', 'image/png', bytes)]);
    const img = imageBlock(r);
    expect(img.mimeType).toBe('image/png');
    expect(Buffer.from(img.data, 'base64').equals(bytes)).toBe(true);
    expect(r.blocks[0]).toEqual({ type: 'text', text: '[1/1] small.png (image/png, 100×80)' });
    expect(r.next).toBeNull();
  });

  it('downscales a 4032x3024 JPEG to a 1568 long edge, re-encodes JPEG and strips EXIF', async () => {
    const bytes = await F.bigPhoneJpeg();
    expect((await sharp(bytes).metadata()).exif).toBeDefined(); // the fixture really carries EXIF
    const r = await read([fileSource('IMG_0412.jpg', 'image/jpeg', bytes)]);
    const img = imageBlock(r);
    const out = Buffer.from(img.data, 'base64');
    const meta = await sharp(out).metadata();
    expect(img.mimeType).toBe('image/jpeg');
    expect(meta.format).toBe('jpeg');
    expect(Math.max(meta.width!, meta.height!)).toBe(1568);
    expect([meta.width, meta.height]).toEqual([1568, 1176]);
    expect(meta.exif).toBeUndefined();
    expect(out.toString('latin1')).not.toContain('SECRET-EXIF-OWNER');
    expect(r.blocks[0]).toMatchObject({ text: '[1/1] IMG_0412.jpg (image/jpeg, scaled from 4032×3024 to 1568×1176)' });
  });

  it('applies EXIF orientation before measuring and scaling', async () => {
    const r = await read([fileSource('rot.jpg', 'image/jpeg', await F.rotatedJpeg())]);
    const meta = await sharp(Buffer.from(imageBlock(r).data, 'base64')).metadata();
    // stored 2000x1000 with orientation 6 displays as 1000x2000; fit inside 1568 => 784x1568
    expect([meta.width, meta.height]).toEqual([784, 1568]);
    expect(meta.orientation).toBeUndefined();
  });

  it('keeps PNG (not JPEG) when the image has alpha', async () => {
    const r = await read([fileSource('alpha.png', 'image/png', await F.alphaPng())]);
    const img = imageBlock(r);
    const meta = await sharp(Buffer.from(img.data, 'base64')).metadata();
    expect(img.mimeType).toBe('image/png');
    expect(meta.hasAlpha).toBe(true);
    expect(meta.width).toBe(1568);
  });

  it('always converts non client-native formats (TIFF) to JPEG, and trusts the bytes over a wrong stored type', async () => {
    const r = await read([fileSource('scan.tiff', 'application/octet-stream', await F.tiff())]);
    const img = imageBlock(r);
    expect(img.mimeType).toBe('image/jpeg');
    expect((r.blocks[0] as { text: string }).text).toContain('image/tiff → image/jpeg');
  });

  it('sends an undecodable HEIC to the fallback with the reason in the label', async () => {
    const r = await read([fileSource('IMG_9.heic', 'image/jpeg', F.undecodableHeic())]);
    expect(r.blocks.map((b) => b.type)).toEqual(['text', 'resource_link']);
    expect((r.blocks[0] as { text: string }).text).toContain('could not be decoded');
    expect(r.omitted).toEqual([{ document_id: 'doc-IMG_9.heic', name: 'IMG_9.heic', mime_type: 'image/heic', reason: 'unreadable_image' }]);
    expect(r.blocks.some((b) => b.type === 'image')).toBe(false);
  });

  it('refuses decompression bombs through limitInputPixels instead of decoding them', async () => {
    // 11000x11000 = 121M pixels > 100M; a flat PNG is only a few hundred KiB.
    const bomb = await sharp({ create: { width: 11000, height: 11000, channels: 3, background: '#000' } }).png({ compressionLevel: 9 }).toBuffer();
    const r = await read([fileSource('bomb.png', 'image/png', bomb)]);
    expect(r.blocks.some((b) => b.type === 'image')).toBe(false);
    expect(r.omitted[0].reason).toBe('unreadable_image');
  }, 60_000);

  it('does not download a file over the size cap (checked against file_size first)', async () => {
    let loaded = false;
    const huge = fileSource('huge.jpg', 'image/jpeg', Buffer.alloc(0), {
      fileSize: 200 * 1024 * 1024,
      loadBytes: async () => {
        loaded = true;
        return Buffer.alloc(0);
      },
    });
    const r = await read([huge]);
    expect(loaded).toBe(false);
    expect(r.omitted[0].reason).toBe('too_large');
    expect(r.blocks.map((b) => b.type)).toEqual(['text', 'resource_link']);
  });
});
