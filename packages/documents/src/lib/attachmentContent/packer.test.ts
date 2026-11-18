import { describe, expect, it } from 'vitest';
import * as F from './__fixtures__/build';
import { fakeRenderer, fileSource } from './__fixtures__/sources';
import { DEFAULT_BUDGET, MIB, readAttachmentContent, type AttachmentSource, type ContentBudget, type ReadResult } from './index';

const start = { docIndex: 0, unitIndex: 0 };
const budget = (over: Partial<ContentBudget>): ContentBudget => ({ ...DEFAULT_BUDGET, ...over });
const imageCount = (r: ReadResult) => r.blocks.filter((b) => b.type === 'image').length;

/** Photos that survive unchanged (small PNGs with distinct names) so costs are predictable. */
async function photos(n: number, size = 300) {
  const out: ReturnType<typeof fileSource>[] = [];
  for (let i = 0; i < n; i++) out.push(fileSource(`IMG_${String(i).padStart(4, '0')}.png`, 'image/png', await F.png(size, size, `#${(i * 37 + 1000).toString(16).slice(-3)}`)));
  return out;
}

describe('packer budgets', () => {
  it('max_images: stops before the 9th image and names the limit', async () => {
    const r = await readAttachmentContent(await photos(22), start, DEFAULT_BUDGET);
    expect(imageCount(r)).toBe(8);
    expect(r.limitsApplied).toContain('max_images');
    expect(r.next).toEqual({ docIndex: 8, unitIndex: 0 });
    expect(r.remaining).toBe('IMG_0008.png, then 13 more attachments');
  });

  it('max_encoded_bytes: a byte budget stops the call and names itself', async () => {
    const r = await readAttachmentContent(await photos(6, 200), start, budget({ maxEncodedBytes: 1500 }));
    expect(r.limitsApplied).toEqual(['max_encoded_bytes']);
    expect(imageCount(r)).toBeGreaterThanOrEqual(1);
    expect(imageCount(r)).toBeLessThan(6);
    expect(r.next).not.toBeNull();
  });

  it('max_text_chars: a text budget stops between units', async () => {
    const text = F.longText(130_000);
    const r = await readAttachmentContent([fileSource('big.txt', 'text/plain', Buffer.from(text))], start, DEFAULT_BUDGET);
    expect(r.limitsApplied).toEqual(['max_text_chars']);
    expect(r.served[0].part).toBe('chunk 1 of 3');
    expect(r.next).toEqual({ docIndex: 0, unitIndex: 1 });
    expect(r.remaining).toBe('chunks 2-3 of 3 of big.txt');
  });

  it('deadline: stops between units once the packing time is spent', async () => {
    let t = 0;
    const r = await readAttachmentContent(await photos(5), start, budget({ deadlineMs: 100 }), { clock: () => (t += 60) });
    expect(r.limitsApplied).toEqual(['deadline']);
    expect(imageCount(r)).toBeGreaterThanOrEqual(1);
    expect(r.next).not.toBeNull();
  });

  it('always makes progress: the first unit is admitted even when it alone exceeds the budget', async () => {
    const r = await readAttachmentContent(await photos(2, 400), start, budget({ maxEncodedBytes: 10, maxImages: 1 }));
    expect(imageCount(r)).toBe(1);
    expect(r.next).toEqual({ docIndex: 1, unitIndex: 0 });
  });

  it('no limit applied and no cursor when everything fits', async () => {
    const r = await readAttachmentContent(await photos(3), start, DEFAULT_BUDGET);
    expect(r.limitsApplied).toEqual([]);
    expect(r.next).toBeNull();
    expect(r.remaining).toBeNull();
  });

  it('does not render the page that would exceed the image cap (cost is read before the render)', async () => {
    const calls: number[][] = [];
    const scan = fileSource('scan.pdf', 'application/pdf', F.buildPdf([null, null, null, null]));
    const r = await readAttachmentContent([scan], start, budget({ maxImages: 2 }), { renderPdfPages: await fakeRenderer(() => F.png(50, 50), calls) });
    expect(calls).toEqual([[1], [2]]);
    expect(r.limitsApplied).toEqual(['max_images']);
    expect(r.next).toEqual({ docIndex: 0, unitIndex: 3 });
    expect(r.served[0].part).toBe('original + pages 1-2 of 4');
    expect(r.remaining).toBe('pages 3-4 of 4 of scan.pdf');
  });

  it('the PDF blob is only sent on the call that starts at the document (never on continuation)', async () => {
    const src = fileSource('guide.pdf', 'application/pdf', F.bornDigitalPdf());
    const second = await readAttachmentContent([src], { docIndex: 0, unitIndex: 2 }, DEFAULT_BUDGET);
    expect(second.blocks.some((b) => b.type === 'resource')).toBe(false);
    expect(second.served[0].part).toBe('pages 2-3 of 3');
  });

  it('following cursors to the end serves every attachment exactly once, in order', async () => {
    const sources: AttachmentSource[] = [...(await photos(12)), fileSource('notes.txt', 'text/plain', Buffer.from(F.longText(70_000))), fileSource('guide.pdf', 'application/pdf', F.bornDigitalPdf())];
    const seen: string[] = [];
    let pos: { docIndex: number; unitIndex: number } | null = start;
    let calls = 0;
    while (pos) {
      const r: ReadResult = await readAttachmentContent(sources, pos, DEFAULT_BUDGET);
      for (const b of r.blocks) {
        if (b.type === 'text' && /^(\[\d+\/\d+\]|---)/.test(b.text)) seen.push(b.text.replace(/ \(.*$/, '').replace(/ ---$/, ''));
      }
      pos = r.next;
      if (++calls > 20) throw new Error('did not terminate');
    }
    const names = seen.map((s) => (s.match(/^(?:--- )?\[\d+\/\d+\] (\S+)/) ?? [])[1]);
    expect(new Set(names).size).toBe(14);
    expect(seen.filter((s) => s.includes('IMG_')).length).toBe(12);
    expect(seen.filter((s) => s.includes('guide.pdf')).length).toBe(1 + 3); // original + 3 pages
    expect(seen.filter((s) => s.includes('notes.txt')).length).toBe(2); // two chunks
    expect(calls).toBeGreaterThan(1);
  });

  it('loads each document\'s bytes at most once per call', async () => {
    const src = fileSource('guide.pdf', 'application/pdf', F.bornDigitalPdf());
    await readAttachmentContent([src], start, DEFAULT_BUDGET);
    expect(src.loads()).toBe(1);
  });
});

describe('mime resolution (R6)', () => {
  it('a phone upload stored as application/octet-stream is read as the image it is', async () => {
    const r = await readAttachmentContent([fileSource('IMG.jpg', 'application/octet-stream', await F.bigPhoneJpeg())], start, DEFAULT_BUDGET);
    expect(imageCount(r)).toBe(1);
    expect((r.blocks[0] as { text: string }).text).toContain('stored type application/octet-stream; detected image/jpeg');
  });

  it('a PDF stored with a wrong type is still read as a PDF', async () => {
    const r = await readAttachmentContent([fileSource('x.bin', 'text/plain', F.bornDigitalPdf())], start, DEFAULT_BUDGET);
    expect(r.served[0].mime_type).toBe('application/pdf');
    expect(r.blocks.some((b) => b.type === 'resource')).toBe(true);
  });

  it('missing type falls back to the extension for text, which has no magic bytes', async () => {
    const r = await readAttachmentContent([fileSource('notes.md', null, Buffer.from('# hi'))], start, DEFAULT_BUDGET);
    expect(r.served[0].mime_type).toBe('text/markdown');
  });

  it('one corrupt attachment does not stop the others', async () => {
    const broken: AttachmentSource = { ...fileSource('bad.png', 'image/png', Buffer.alloc(0)), loadBytes: async () => { throw new Error('storage unavailable'); } };
    const r = await readAttachmentContent([broken, ...(await photos(1))], start, DEFAULT_BUDGET);
    expect(r.omitted[0]).toMatchObject({ name: 'bad.png', reason: 'unreadable' });
    expect(imageCount(r)).toBe(1);
  });
});

describe('sanity', () => {
  it('MIB constant', () => expect(MIB).toBe(1048576));
});
