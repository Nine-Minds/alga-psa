/**
 * Generates packages/billing/src/lib/pdf-fonts/fontFaceCss.generated.ts from the
 * static font instances in server/src/app/fonts/pdf (derived from the app's own
 * variable fonts by scripts/instance-pdf-fonts.py).
 *
 * Server-side PDFs are pushed into Chromium with page.setContent(), so the
 * document has no origin to resolve a font URL against: the faces are inlined
 * as woff2 data URIs instead. The CSS is generated rather than read with `fs` at
 * runtime because this package is prebuilt with tsup (bundle: false, no asset
 * copying) and runs from src in Next, from dist in the workers, and from the
 * repo in CI — one baked-in string behaves identically in all three.
 *
 * Run `npm run generate:pdf-fonts --prefix packages/billing` after changing an
 * instance; pdfFonts.drift.test.ts fails if the two ever diverge.
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, '../../..');
const fontDirectory = path.join(repositoryRoot, 'server/src/app/fonts/pdf');
const outputPath = path.join(scriptDirectory, '../src/lib/pdf-fonts/fontFaceCss.generated.ts');

/**
 * The weights the renderers and repo-owned templates ask for: 400 body, 600 table
 * headers, 700 headings, 800 label identifiers (mono). CSS font matching maps any
 * other requested weight to the nearest of these, so no face is synthesised.
 */
const FACES = [
  { file: 'Inter-Regular.woff2', family: 'Inter', style: 'normal', weight: 400 },
  { file: 'Inter-SemiBold.woff2', family: 'Inter', style: 'normal', weight: 600 },
  { file: 'Inter-Bold.woff2', family: 'Inter', style: 'normal', weight: 700 },
  { file: 'Inter-Italic.woff2', family: 'Inter', style: 'italic', weight: 400 },
  { file: 'JetBrainsMono-Regular.woff2', family: 'JetBrains Mono', style: 'normal', weight: 400 },
  { file: 'JetBrainsMono-ExtraBold.woff2', family: 'JetBrains Mono', style: 'normal', weight: 800 },
];

const faces = FACES.map((face) => {
  const binary = fs.readFileSync(path.join(fontDirectory, face.file));
  return {
    ...face,
    base64: binary.toString('base64'),
    sha256: createHash('sha256').update(binary).digest('hex'),
  };
});

// Inter (every weight) substitutes a different glyph for "-" when it sits
// between two digits — a contextual alternate meant to look like a minus sign
// in numeric ranges. Chromium's PDF subsetter doesn't carry a ToUnicode
// mapping for that alternate glyph back to U+002D, so dates, invoice numbers
// and UUID-ish identifiers (e.g. "2026-11-05", "7dc8-4fee") silently lose the
// hyphen on copy/extract, which is exactly the illegible-print problem these
// faces exist to fix. Declaring the feature off on the face itself (a valid
// @font-face descriptor in Chromium) keeps every consumer off it without
// touching per-element font-family stacks.
const rule = (face) => `@font-face {
  font-family: '${face.family}';
  font-style: ${face.style};
  font-weight: ${face.weight};
  font-display: block;
  font-feature-settings: 'calt' 0;
  src: url(data:font/woff2;base64,${face.base64}) format('woff2');
}`;

const contents = `/**
 * GENERATED FILE — do not edit.
 *
 * Source: server/src/app/fonts/pdf/*.woff2
 * Regenerate: npm run generate:pdf-fonts --prefix packages/billing
 * Guarded by: src/lib/pdf-fonts/pdfFonts.drift.test.ts
 */

/** SHA-256 of each font binary the inlined data URIs below were built from. */
export const PDF_FONT_SOURCE_SHA256: Readonly<Record<string, string>> = {
${faces.map((face) => `  '${face.file}': '${face.sha256}',`).join('\n')}
};

/**
 * \`@font-face\` rules for the bundled PDF fonts, with the woff2 payloads inlined.
 * The \`: string\` annotation is load-bearing: without it TypeScript keeps a literal
 * type for ~650 KB of base64 and \`tsc\` runs the default heap out of memory.
 */
export const PDF_FONT_FACE_CSS: string = ${JSON.stringify(faces.map(rule).join('\n\n'))};
`;

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, contents);
console.log(
  `Wrote ${path.relative(repositoryRoot, outputPath)} (${(contents.length / 1024).toFixed(0)} KB, ${faces.length} faces)`
);
