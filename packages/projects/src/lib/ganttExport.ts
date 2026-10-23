/**
 * Timeline image export. The on-screen chart is positioned HTML, which cannot be
 * rasterised without a DOM-capture dependency, so the export redraws the same
 * layout as a standalone SVG and paints that onto a canvas.
 */

/** What an arrow means; the export picks the colour, since the image has its own palette. */
export type GanttExportArrowTone = 'blocking' | 'related' | 'critical' | 'conflict';

export interface GanttExportModel {
  title: string;
  leftWidth: number;
  chartWidth: number;
  headerBandHeight: number;
  rowHeight: number;
  majors: { x: number; width: number; label: string }[];
  minors: { x: number; width: number; label: string; isWeekend: boolean }[];
  todayX: number | null;
  rows: { kind: 'phase' | 'task'; label: string }[];
  /** Chart-relative geometry; `row` is the row index. */
  phaseBands: {
    row: number;
    x: number;
    width: number;
    /** Share of the phase's tasks completed, 0..1. */
    progress: number;
    label: string;
    overrunWidth: number;
    /** Task rows below the phase row that the lane tint covers. */
    laneRows: number;
  }[];
  /** Colour of the phase band (the open-task colour). */
  accentColor: string;
  bars: {
    row: number;
    x: number;
    width: number;
    height: number;
    color: string;
    /** Completed: drawn with the same neutral shade as on screen. */
    dimmed?: boolean;
    progress: number;
    inferred: boolean;
    critical: boolean;
  }[];
  arrows: { d: string; tone: GanttExportArrowTone }[];
}

/** Largest canvas edge browsers reliably allocate. */
const MAX_CANVAS_EDGE = 16000;
const TITLE_HEIGHT = 36;
const FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';

const INK = '#1f2937';
const MUTED = '#6b7280';
const RULE = '#e5e7eb';
const BAND = '#f9fafb';
const CRITICAL = '#f59e0b';
// The image is always drawn on white, whatever theme the app is in, so its
// line colours are fixed here rather than read from theme variables.
const ARROW_COLORS: Record<GanttExportArrowTone, string> = {
  blocking: '#374151',
  related: '#2563eb',
  critical: CRITICAL,
  conflict: '#ef4444',
};

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function truncate(label: string, maxChars: number): string {
  return label.length > maxChars ? `${label.slice(0, Math.max(1, maxChars - 1))}…` : label;
}

/** Resolve a `--color-*` triplet to a concrete colour; an image cannot read CSS variables. */
export function resolveCssColor(variable: string, fallback: string): string {
  if (typeof window === 'undefined') return fallback;
  const raw = getComputedStyle(document.documentElement).getPropertyValue(variable).trim();
  const parts = raw.split(/[\s,]+/).filter(Boolean);
  return parts.length >= 3 ? `rgb(${parts[0]}, ${parts[1]}, ${parts[2]})` : fallback;
}

export function buildGanttSvg(model: GanttExportModel): { svg: string; width: number; height: number } {
  const headerHeight = model.headerBandHeight * 2;
  const bodyTop = TITLE_HEIGHT + headerHeight;
  const width = model.leftWidth + model.chartWidth;
  const height = bodyTop + model.rows.length * model.rowHeight;
  const cx = model.leftWidth;
  const rowMid = (row: number) => bodyTop + row * model.rowHeight + model.rowHeight / 2;
  const out: string[] = [];

  out.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family='${FONT}'>`,
    `<defs><marker id="a" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto"><path d="M0,0 L6,3 L0,6 Z" fill="${MUTED}"/></marker>`,
    `<pattern id="h" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="3" height="6" fill="#ffffff" fill-opacity="0.5"/></pattern></defs>`,
    `<rect width="${width}" height="${height}" fill="#ffffff"/>`,
    `<text x="12" y="23" font-size="15" font-weight="600" fill="${INK}">${escapeXml(model.title)}</text>`,
  );

  // Weekend / column stripes behind everything else.
  for (const minor of model.minors) {
    if (minor.isWeekend) {
      out.push(`<rect x="${cx + minor.x}" y="${TITLE_HEIGHT + model.headerBandHeight}" width="${minor.width}" height="${height - TITLE_HEIGHT - model.headerBandHeight}" fill="${BAND}"/>`);
    }
    out.push(`<line x1="${cx + minor.x + minor.width}" y1="${TITLE_HEIGHT + model.headerBandHeight}" x2="${cx + minor.x + minor.width}" y2="${height}" stroke="${RULE}" stroke-width="0.5"/>`);
    if (minor.label && minor.width >= 18) {
      out.push(`<text x="${cx + minor.x + minor.width / 2}" y="${TITLE_HEIGHT + model.headerBandHeight + 16}" font-size="10" text-anchor="middle" fill="${MUTED}">${escapeXml(minor.label)}</text>`);
    }
  }
  for (const major of model.majors) {
    out.push(`<line x1="${cx + major.x + major.width}" y1="${TITLE_HEIGHT}" x2="${cx + major.x + major.width}" y2="${TITLE_HEIGHT + model.headerBandHeight}" stroke="${RULE}"/>`);
    if (major.width >= 40) {
      out.push(`<text x="${cx + major.x + 8}" y="${TITLE_HEIGHT + 16}" font-size="12" font-weight="500" fill="${INK}">${escapeXml(truncate(major.label, Math.floor(major.width / 7)))}</text>`);
    }
  }

  // Row bands, labels and rules.
  model.rows.forEach((row, index) => {
    const y = bodyTop + index * model.rowHeight;
    if (row.kind === 'phase') {
      out.push(`<rect x="0" y="${y}" width="${width}" height="${model.rowHeight}" fill="${BAND}" fill-opacity="0.8"/>`);
    }
    out.push(`<line x1="0" y1="${y + model.rowHeight}" x2="${width}" y2="${y + model.rowHeight}" stroke="${RULE}" stroke-width="0.5"/>`);
    const indent = row.kind === 'task' ? 28 : 12;
    out.push(
      `<text x="${indent}" y="${y + model.rowHeight / 2 + 4}" font-size="12" font-weight="${row.kind === 'phase' ? 600 : 400}" fill="${INK}">${escapeXml(truncate(row.label, Math.floor((model.leftWidth - indent - 8) / 6.5)))}</text>`,
    );
  });
  out.push(
    `<rect x="0" y="${bodyTop}" width="${model.leftWidth}" height="0" fill="none"/>`,
    `<line x1="${cx}" y1="${TITLE_HEIGHT}" x2="${cx}" y2="${height}" stroke="${RULE}"/>`,
    `<line x1="0" y1="${bodyTop}" x2="${width}" y2="${bodyTop}" stroke="${RULE}"/>`,
    `<line x1="0" y1="${TITLE_HEIGHT}" x2="${width}" y2="${TITLE_HEIGHT}" stroke="${RULE}"/>`,
  );

  for (const band of model.phaseBands) {
    const x = cx + band.x;
    const top = rowMid(band.row) - model.rowHeight / 2;
    if (band.laneRows > 0) {
      out.push(`<rect x="${x}" y="${top + model.rowHeight}" width="${band.width}" height="${band.laneRows * model.rowHeight}" fill="${model.accentColor}" fill-opacity="0.05"/>`);
    }
    const y = top + 5;
    const h = model.rowHeight - 10;
    out.push(
      `<rect x="${x}" y="${y}" width="${band.width}" height="${h}" rx="2" fill="${model.accentColor}" fill-opacity="0.14" stroke="${model.accentColor}" stroke-opacity="0.45"/>`,
      `<rect x="${x}" y="${y}" width="${band.width * band.progress}" height="${h}" rx="2" fill="${model.accentColor}" fill-opacity="0.3"/>`,
    );
    if (band.overrunWidth > 0) {
      out.push(`<rect x="${x + band.width}" y="${y}" width="${band.overrunWidth}" height="${h}" fill="#ef4444" fill-opacity="0.14" stroke="#ef4444" stroke-opacity="0.6" stroke-dasharray="3 2"/>`);
    }
    const inside = band.width >= 170;
    out.push(
      `<text x="${inside ? x + 8 : x + band.width + band.overrunWidth + 8}" y="${rowMid(band.row) + 4}" font-size="11" font-weight="500" fill="${INK}">${escapeXml(inside ? truncate(band.label, Math.floor((band.width - 16) / 6)) : band.label)}</text>`,
    );
  }

  for (const bar of model.bars) {
    const x = cx + bar.x;
    const y = rowMid(bar.row) - bar.height / 2;
    out.push(`<rect x="${x}" y="${y}" width="${bar.width}" height="${bar.height}" rx="2" fill="${bar.color}"/>`);
    if (bar.dimmed) {
      out.push(`<rect x="${x}" y="${y}" width="${bar.width}" height="${bar.height}" rx="2" fill="#000000" fill-opacity="0.2"/>`);
    }
    if (bar.progress > 0) {
      out.push(`<rect x="${x}" y="${y}" width="${Math.max(2, bar.width * bar.progress)}" height="${bar.height}" rx="2" fill="#000000" fill-opacity="0.3"/>`);
    }
    if (bar.inferred) {
      out.push(
        `<rect x="${x}" y="${y}" width="${bar.width}" height="${bar.height}" rx="2" fill="url(#h)"/>`,
        `<rect x="${x + 0.5}" y="${y + 0.5}" width="${Math.max(1, bar.width - 1)}" height="${bar.height - 1}" rx="2" fill="none" stroke="#000000" stroke-opacity="0.45" stroke-dasharray="3 2"/>`,
      );
    }
    if (bar.critical) {
      out.push(`<rect x="${x - 2}" y="${y - 2}" width="${bar.width + 4}" height="${bar.height + 4}" rx="3" fill="none" stroke="${CRITICAL}" stroke-width="2"/>`);
    }
  }

  out.push(`<g transform="translate(${cx} ${bodyTop})" fill="none">`);
  for (const arrow of model.arrows) {
    out.push(
      `<path d="${arrow.d}" stroke="${ARROW_COLORS[arrow.tone]}" stroke-width="1"${arrow.tone === 'related' ? ' stroke-dasharray="2 3"' : ' marker-end="url(#a)"'}/>`,
    );
  }
  out.push('</g>');

  if (model.todayX !== null) {
    out.push(`<line x1="${cx + model.todayX}" y1="${bodyTop}" x2="${cx + model.todayX}" y2="${height}" stroke="#ef4444" stroke-width="1.5" stroke-dasharray="4 3"/>`);
  }

  out.push('</svg>');
  return { svg: out.join(''), width, height };
}

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Give the browser a tick to start the download before the URL is revoked.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Download the timeline as a PNG. A chart too large for a canvas (a long project
 * at day scale) falls back to the SVG itself, which has no size ceiling.
 */
export async function exportGanttImage(model: GanttExportModel, filenameBase: string): Promise<'png' | 'svg'> {
  const { svg, width, height } = buildGanttSvg(model);
  const svgBlob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });

  if (width > MAX_CANVAS_EDGE || height > MAX_CANVAS_EDGE) {
    download(svgBlob, `${filenameBase}.svg`);
    return 'svg';
  }

  const scale = Math.max(1, Math.min(2, MAX_CANVAS_EDGE / width, MAX_CANVAS_EDGE / height));
  const url = URL.createObjectURL(svgBlob);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Timeline image failed to render'));
      img.src = url;
    });
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(height * scale);
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas is unavailable');
    context.scale(scale, scale);
    context.drawImage(image, 0, 0, width, height);
    const png = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!png) throw new Error('Timeline image failed to encode');
    download(png, `${filenameBase}.png`);
    return 'png';
  } finally {
    URL.revokeObjectURL(url);
  }
}
