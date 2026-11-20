import JSZip from 'jszip';
import sharp from 'sharp';

/** Deterministic fixture builders: everything is generated in memory, nothing is checked in as a blob except encrypted.pdf. */

export const png = (width = 100, height = 80, color = '#cc3322') =>
  sharp({ create: { width, height, channels: 3, background: color } }).png().toBuffer();

/** A phone-style JPEG: 4032x3024, EXIF orientation 1 and a copyright EXIF tag that must not survive. */
export const bigPhoneJpeg = () =>
  sharp({ create: { width: 4032, height: 3024, channels: 3, background: '#336699' } })
    .jpeg({ quality: 90 })
    .withExif({ IFD0: { Copyright: 'SECRET-EXIF-OWNER' } })
    .toBuffer();

/** Landscape file stored rotated: EXIF orientation 6 (rotate 90° CW), so the displayed size is 1000x2000. */
export const rotatedJpeg = () =>
  sharp({ create: { width: 2000, height: 1000, channels: 3, background: '#aa8844' } })
    .jpeg()
    .withMetadata({ orientation: 6 })
    .toBuffer();

export const alphaPng = () =>
  sharp({ create: { width: 2000, height: 1000, channels: 4, background: { r: 10, g: 200, b: 30, alpha: 0.5 } } }).png().toBuffer();

export const tiff = () => sharp({ create: { width: 120, height: 90, channels: 3, background: '#112233' } }).tiff().toBuffer();

/** Looks like HEIC to a sniffer (ftyp/heic) but no decoder can open it. */
export const undecodableHeic = () =>
  Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftypheic'), Buffer.from([0, 0, 0, 0]), Buffer.from('mif1heic'), Buffer.alloc(64, 7)]);

export const zip = async () => {
  const z = new JSZip();
  z.file('hello.txt', 'hello');
  return z.generateAsync({ type: 'nodebuffer' });
};

/** Minimal valid PDF. `pages[i]` is the text of page i+1, or null for a page with no text layer at all (a "scan"). */
export function buildPdf(pages: Array<string | null>): Buffer {
  const objects: string[] = [];
  const add = (body: string) => {
    objects.push(body);
    return objects.length; // 1-based object number
  };
  const catalog = add('');
  const pagesObj = add('');
  const font = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  const pageIds: number[] = [];
  for (const text of pages) {
    let contentRef = '';
    if (text !== null) {
      const stream = `BT /F1 12 Tf 72 720 Td (${text.replace(/[()\\]/g, '\\$&')}) Tj ET`;
      const content = add(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
      contentRef = `/Contents ${content} 0 R`;
    }
    pageIds.push(
      add(`<< /Type /Page /Parent ${pagesObj} 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${font} 0 R >> >> ${contentRef} >>`),
    );
  }
  objects[catalog - 1] = `<< /Type /Catalog /Pages ${pagesObj} 0 R >>`;
  objects[pagesObj - 1] = `<< /Type /Pages /Count ${pageIds.length} /Kids [${pageIds.map((i) => `${i} 0 R`).join(' ')}] >>`;

  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const o of offsets) out += `${String(o).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

export const bornDigitalPdf = () =>
  buildPdf([
    'Page one: the installation guide begins here.',
    'Page two: configure the Citrix gateway.',
    'Page three: verify the checklist items.',
  ]);

export const scannedPdf = () => buildPdf([null, null]);
export const mixedPdf = () => buildPdf(['Page one has a real text layer here.', null, 'Page three also has a text layer.']);

const DOC_NS =
  'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"';

/** A DOCX with a heading, a bold run, a bullet-less paragraph and one embedded picture. */
export async function docx(): Promise<Buffer> {
  const z = new JSZip();
  z.file(
    '[Content_Types].xml',
    '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
  );
  z.file(
    '_rels/.rels',
    '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
  );
  z.file(
    'word/_rels/document.xml.rels',
    '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId5" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image1.png"/></Relationships>',
  );
  z.file('word/media/image1.png', await png(8, 8));
  z.file(
    'word/document.xml',
    `<?xml version="1.0" encoding="UTF-8"?><w:document ${DOC_NS}><w:body>` +
      '<w:p><w:r><w:t>Migration plan</w:t></w:r></w:p>' +
      '<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>Bold step</w:t></w:r><w:r><w:t xml:space="preserve"> then a plain step.</w:t></w:r></w:p>' +
      '<w:p><w:r><w:drawing><wp:inline><wp:extent cx="95250" cy="95250"/><wp:docPr id="1" name="Picture 1"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="0" name="image1.png"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="rId5"/></pic:blipFill><pic:spPr/></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>' +
      '</w:body></w:document>',
  );
  return z.generateAsync({ type: 'nodebuffer' });
}

export const html = () =>
  Buffer.from(
    '<html><head><style>.x{color:red}</style><script>alert("SCRIPT-BODY")</script></head><body><h1>Runbook</h1><p>Restart the <strong>gateway</strong>.</p><ul><li>one</li><li>two</li></ul></body></html>',
  );

/** n lines of 100 chars ("line 00001 ...") so the text is splittable at line boundaries. */
export const longText = (chars = 150_000) => {
  const lines: string[] = [];
  let total = 0;
  for (let i = 1; total < chars; i++) {
    const l = `line ${String(i).padStart(6, '0')} ${'x'.repeat(86)}`;
    lines.push(l);
    total += l.length + 1;
  }
  return lines.join('\n');
};
