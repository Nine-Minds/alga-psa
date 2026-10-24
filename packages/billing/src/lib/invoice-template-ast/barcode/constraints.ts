/**
 * Scannability rules for the `barcode` AST node. Pure and dependency-free: it is imported by the
 * shared (browser + server) renderer and by tests, and must never pull in `qrcode` or `bwip-js`
 * (those live behind barcode/*.server.ts and are loaded by dynamic import on the server only).
 */

export type BarcodeSymbology = 'qr' | 'code128';

/** Minimum blank border, in modules, around the symbol (QR spec: 4; Code 128 spec: 10). */
export const BARCODE_QUIET_ZONE_MODULES: Record<BarcodeSymbology, number> = {
  qr: 4,
  code128: 10,
};

/** Smallest printed module that phone cameras and typical 203 dpi thermal printers resolve. */
export const BARCODE_MIN_MODULE_MM = 0.25;

/** Natural module size when the node declares no width. */
export const BARCODE_DEFAULT_MODULE_MM = 0.5;

export class BarcodeError extends Error {
  readonly code: 'empty-value' | 'unencodable' | 'too-large' | 'too-small';
  constructor(code: BarcodeError['code'], message: string) {
    super(message);
    this.name = 'BarcodeError';
    this.code = code;
  }
}

const MM_PER_UNIT: Record<string, number> = {
  mm: 1,
  cm: 10,
  in: 25.4,
  pt: 25.4 / 72,
  px: 25.4 / 96,
};

/** Width of a CSS length in millimetres; null for anything unitful we cannot resolve (%, auto). */
export const cssLengthToMm = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value * MM_PER_UNIT.px;
  }
  if (typeof value !== 'string') return null;
  const match = /^\s*(\d+(?:\.\d+)?)\s*(mm|cm|in|pt|px)?\s*$/i.exec(value);
  if (!match) return null;
  const unit = (match[2] ?? 'px').toLowerCase();
  return Number(match[1]) * MM_PER_UNIT[unit];
};

export interface BarcodeSizing {
  /** Total modules across, quiet zone included. */
  totalModules: number;
  /** Printed width of the whole symbol (quiet zone included) in mm. */
  widthMm: number;
  moduleMm: number;
}

/**
 * Resolve the printed size and enforce the minimum module size. `declaredWidthMm` is the node's
 * own width (null = natural size at the default module size).
 */
export const resolveBarcodeSizing = (
  symbology: BarcodeSymbology,
  totalModules: number,
  declaredWidthMm: number | null
): BarcodeSizing => {
  if (!Number.isFinite(totalModules) || totalModules <= 0) {
    throw new BarcodeError('unencodable', 'Barcode has no modules to print');
  }
  const widthMm = declaredWidthMm ?? totalModules * BARCODE_DEFAULT_MODULE_MM;
  const moduleMm = widthMm / totalModules;
  if (moduleMm + 1e-9 < BARCODE_MIN_MODULE_MM) {
    throw new BarcodeError(
      'too-small',
      `${symbology === 'qr' ? 'QR code' : 'Code 128 barcode'} needs ${totalModules} modules across (quiet zone included); ` +
        `at ${widthMm.toFixed(1)} mm wide each module would be ${moduleMm.toFixed(3)} mm, below the ` +
        `${BARCODE_MIN_MODULE_MM} mm minimum. Make the barcode wider or the value shorter.`
    );
  }
  return { totalModules, widthMm, moduleMm };
};

const xmlEscape = (value: string): string => value.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);

/**
 * 2D (QR) symbols stay square and scale uniformly: `height:auto` + `max-width:100%` keeps the aspect ratio.
 * 1D (Code 128) symbols are only meaningful in the horizontal axis, so when the node declares a height the SVG
 * is emitted at exactly that mm height with `preserveAspectRatio="none"` (bars stretch vertically only).
 * Squeeze rule for 1D: `max-width:100%` is NOT emitted, so a narrow container can never shrink the module width
 * below what `resolveBarcodeSizing` validated; an over-wide symbol overflows (and is clipped) instead of
 * silently becoming unscannable. `preserveAspectRatio="none"` is never used for QR.
 */
const svgOpen = (
  width: number,
  height: number,
  widthMm: number,
  label: string,
  symbology: BarcodeSymbology,
  declaredHeightMm: number | null = null
): string => {
  const oneD = symbology === 'code128';
  const heightMm = oneD && declaredHeightMm != null ? declaredHeightMm : (widthMm * height) / width;
  const fixedHeight = oneD && declaredHeightMm != null;
  const style = oneD ? 'display:block' : 'display:block;max-width:100%;height:auto';
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" ` +
    `width="${+widthMm.toFixed(3)}mm" height="${+heightMm.toFixed(3)}mm"` +
    `${fixedHeight ? ' preserveAspectRatio="none"' : ''} ` +
    `shape-rendering="crispEdges" role="img" aria-label="${xmlEscape(label)}" style="${style}">` +
    `<rect width="${width}" height="${height}" fill="#fff"/>`
  );
};

/** QR symbol. `rows[y][x]` is true for a dark module. The quiet zone is part of the viewBox. */
export const qrMatrixToSvg = (rows: boolean[][], declaredWidthMm: number | null, label: string): string => {
  const size = rows.length;
  const quiet = BARCODE_QUIET_ZONE_MODULES.qr;
  const total = size + quiet * 2;
  const { widthMm } = resolveBarcodeSizing('qr', total, declaredWidthMm);
  let path = '';
  for (let y = 0; y < size; y += 1) {
    let x = 0;
    while (x < size) {
      if (!rows[y][x]) {
        x += 1;
        continue;
      }
      const start = x;
      while (x < size && rows[y][x]) x += 1;
      path += `M${start + quiet} ${y + quiet}h${x - start}v1h-${x - start}z`;
    }
  }
  return `${svgOpen(total, total, widthMm, label, 'qr')}<path fill="#000" d="${path}"/></svg>`;
};

/**
 * Code 128 symbol from bwip-js `raw` widths: alternating bar, space, bar... in modules, starting
 * with a bar. Printed height is `declaredHeightMm` when the node declares one; otherwise the natural
 * height is 30% of the symbol length (floor 30 modules), so it scales with the width.
 */
export const code128BarsToSvg = (
  widths: number[],
  declaredWidthMm: number | null,
  label: string,
  declaredHeightMm: number | null = null
): string => {
  const quiet = BARCODE_QUIET_ZONE_MODULES.code128;
  const symbolModules = widths.reduce((sum, w) => sum + w, 0);
  const total = symbolModules + quiet * 2;
  const { widthMm } = resolveBarcodeSizing('code128', total, declaredWidthMm);
  const height = Math.max(Math.ceil(total * 0.3), 30);
  let x = quiet;
  let path = '';
  widths.forEach((w, index) => {
    if (index % 2 === 0) path += `M${x} 0h${w}v${height}h-${w}z`;
    x += w;
  });
  return `${svgOpen(total, height, widthMm, label, 'code128', declaredHeightMm)}<path fill="#000" d="${path}"/></svg>`;
};
