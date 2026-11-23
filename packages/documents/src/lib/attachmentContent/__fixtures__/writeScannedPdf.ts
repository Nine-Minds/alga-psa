/**
 * Test-only: write an N-page fully scanned PDF (no text layer on any page) for the V4 timing check.
 * Generated on demand so no binary is committed.
 *
 *   npx tsx packages/documents/src/lib/attachmentContent/__fixtures__/writeScannedPdf.ts /tmp/scan-40.pdf 40
 */
import fs from 'node:fs';
import { buildPdf } from './build';

const [out, pagesArg] = process.argv.slice(2);
if (!out) {
  console.error('usage: writeScannedPdf.ts <output.pdf> [pages=40]');
  process.exit(2);
}
const pages = Number(pagesArg ?? 40);
if (!Number.isInteger(pages) || pages < 1) {
  console.error('pages must be a positive integer');
  process.exit(2);
}
fs.writeFileSync(out, buildPdf(Array.from({ length: pages }, () => null)));
console.log(`wrote ${pages}-page scanned PDF to ${out}`);
