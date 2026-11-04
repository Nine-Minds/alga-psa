import { describe, expect, it } from 'vitest';
import { MAX_LABEL_LOGO_BYTES, fileIdFromLogoUrl, inlineLogoDataUrl, toLogoDataUrl } from './labelLogo';

const FILE = '11111111-2222-4333-8444-555555555555';
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(16)]);

describe('label logo inlining (R1)', () => {
  it('parses the file id out of the app document URL, with or without a cache-buster', () => {
    expect(fileIdFromLogoUrl(`/api/documents/view/${FILE}?t=123`)).toBe(FILE);
    expect(fileIdFromLogoUrl(`/api/documents/view/${FILE}`)).toBe(FILE);
    expect(fileIdFromLogoUrl('https://evil.example/logo.png')).toBeNull();
    expect(fileIdFromLogoUrl(null)).toBeNull();
  });

  it('inlines a real image as a data URL and trusts the bytes, not the name', async () => {
    const url = await inlineLogoDataUrl(`/api/documents/view/${FILE}?t=1`, async () => PNG);
    expect(url).toBe(`data:image/png;base64,${PNG.toString('base64')}`);
  });

  it('omits (null) rather than failing: oversize, unknown format, active SVG, load error, missing file', async () => {
    expect(toLogoDataUrl(Buffer.concat([PNG, Buffer.alloc(MAX_LABEL_LOGO_BYTES)]))).toBeNull();
    expect(toLogoDataUrl(Buffer.from('not an image'))).toBeNull();
    expect(toLogoDataUrl(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>x()</script></svg>'))).toBeNull();
    expect(toLogoDataUrl(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>'))).toMatch(/^data:image\/svg\+xml;base64,/);
    expect(await inlineLogoDataUrl(`/api/documents/view/${FILE}`, async () => { throw new Error('storage down'); })).toBeNull();
    expect(await inlineLogoDataUrl(`/api/documents/view/${FILE}`, async () => null)).toBeNull();
    expect(await inlineLogoDataUrl('/somewhere/else.png', async () => PNG)).toBeNull();
  });
});
