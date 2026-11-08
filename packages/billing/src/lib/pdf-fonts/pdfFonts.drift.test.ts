/**
 * fontFaceCss.generated.ts is produced by scripts/generate-pdf-fonts.mjs from the
 * static instances in server/src/app/fonts/pdf. Nothing reads those binaries at
 * runtime, so a font change that skips the codegen step would leave every PDF on
 * the old face with no other signal. This asserts the inlined payloads still are
 * the binaries, and that no face is variable: Chromium embeds a variable font as
 * Type 3 glyph procedures instead of a TrueType subset.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { PDF_FONT_FACE_CSS, PDF_FONT_SOURCE_SHA256 } from './index';

const fontDirectory = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../../../server/src/app/fonts/pdf'
);

const sha256 = (buffer: Buffer | Uint8Array) => createHash('sha256').update(buffer).digest('hex');

const inlinedPayloads = (): string[] =>
  [...PDF_FONT_FACE_CSS.matchAll(/url\(data:font\/woff2;base64,([A-Za-z0-9+/=]+)\)/g)].map((m) => m[1]);

/** woff2 header: 'wOF2', then the sfnt flavour of the compressed font. */
const isWoff2 = (font: Uint8Array) => Buffer.from(font.subarray(0, 4)).toString('latin1') === 'wOF2';

describe('bundled PDF fonts', () => {
  it('inlines exactly the static instances, unchanged', () => {
    const files = Object.keys(PDF_FONT_SOURCE_SHA256);
    expect(files).toEqual([
      'Inter-Regular.woff2',
      'Inter-SemiBold.woff2',
      'Inter-Bold.woff2',
      'Inter-Italic.woff2',
      'JetBrainsMono-Regular.woff2',
      'JetBrainsMono-ExtraBold.woff2',
    ]);

    for (const file of files) {
      expect(sha256(readFileSync(path.join(fontDirectory, file))), file).toBe(PDF_FONT_SOURCE_SHA256[file]);
    }

    const payloads = inlinedPayloads();
    expect(payloads).toHaveLength(files.length);
    payloads.forEach((payload, index) => {
      const font = Buffer.from(payload, 'base64');
      expect(isWoff2(font), files[index]).toBe(true);
      expect(sha256(font), files[index]).toBe(PDF_FONT_SOURCE_SHA256[files[index]]);
    });
  });

  it('declares Inter (400/600/700 + italic) and JetBrains Mono (400/800)', () => {
    const declared = [...PDF_FONT_FACE_CSS.matchAll(/font-family: '([^']+)';\s+font-style: (\w+);\s+font-weight: (\d+);/g)].map(
      (m) => `${m[1]} ${m[3]} ${m[2]}`
    );
    expect(declared).toEqual([
      'Inter 400 normal',
      'Inter 600 normal',
      'Inter 700 normal',
      'Inter 400 italic',
      'JetBrains Mono 400 normal',
      'JetBrains Mono 800 normal',
    ]);
    // No origin to resolve against under page.setContent(): every src must be inline.
    expect(PDF_FONT_FACE_CSS).not.toMatch(/src:\s*url\((?!data:)/);
    // A weight range would make Blink apply variation settings; these are static faces.
    expect(PDF_FONT_FACE_CSS).not.toMatch(/font-weight: \d+ \d+/);
  });
});
