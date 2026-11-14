/**
 * The fonts every server-generated PDF carries with it.
 *
 * PDF HTML is handed to Chromium with `page.setContent()`, so the document has
 * no origin to resolve a font URL against, and the server image ships no Inter:
 * a bare `system-ui`/`sans-serif` stack falls through fontconfig to FreeSans,
 * which Chromium embeds as Type 3 glyph outlines that print badly — and lands on
 * a different face on macOS, in CI and on self-hosted Debian. Emitting these
 * `@font-face` rules into the PDF head makes the bundled Inter / JetBrains Mono
 * the first choice everywhere, with the system stack still behind them for
 * templates that ask for Arial/Helvetica and for glyph coverage.
 *
 * The faces are static instances of the app's variable fonts (see
 * scripts/instance-pdf-fonts.py): Chromium cannot embed a variable font in a PDF
 * and falls back to Type 3 glyph procedures for it, which is the very rough,
 * unsearchable print this is meant to fix.
 */
export { PDF_FONT_FACE_CSS, PDF_FONT_SOURCE_SHA256 } from './fontFaceCss.generated';
