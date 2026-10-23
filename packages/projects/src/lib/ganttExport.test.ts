/* @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { buildGanttSvg, exportGanttImage, resolveCssColor, type GanttExportModel } from './ganttExport';

function model(overrides: Partial<GanttExportModel> = {}): GanttExportModel {
  return {
    title: 'Migration · Timeline',
    leftWidth: 400,
    chartWidth: 700,
    headerBandHeight: 24,
    rowHeight: 36,
    majors: [{ x: 0, width: 700, label: 'October 2026' }],
    minors: [
      { x: 0, width: 350, label: 'Oct 5', isWeekend: false },
      { x: 350, width: 350, label: 'Oct 12', isWeekend: true },
    ],
    todayX: 120,
    rows: [
      { kind: 'phase', label: 'Build' },
      { kind: 'task', label: 'Deploy <prod> & verify' },
      { kind: 'task', label: 'Done task' },
    ],
    phaseBands: [{ row: 0, x: 20, width: 300, progress: 0.5, label: 'Oct 5 – Oct 16 · 50%', overrunWidth: 40, laneRows: 2 }],
    accentColor: 'rgb(138, 77, 234)',
    bars: [
      { row: 1, x: 30, width: 120, height: 26, color: 'rgb(138, 77, 234)', progress: 0.25, inferred: true, critical: true },
      { row: 2, x: 160, width: 80, height: 26, color: 'rgb(34, 197, 94)', dimmed: true, progress: 0, inferred: false, critical: false },
    ],
    arrows: [
      { d: 'M 150 54 L 160 90', tone: 'blocking' },
      { d: 'M 10 54 L 20 90', tone: 'related' },
    ],
    ...overrides,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  document.documentElement.removeAttribute('style');
});

describe('buildGanttSvg', () => {
  it('sizes the image to the left column, chart, header and rows', () => {
    const { width, height, svg } = buildGanttSvg(model());
    expect(width).toBe(1100);
    // title strip + two header bands + three rows
    expect(height).toBe(36 + 48 + 3 * 36);
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
    expect(svg.endsWith('</svg>')).toBe(true);
  });

  it('escapes task and phase names', () => {
    const { svg } = buildGanttSvg(model());
    expect(svg).toContain('Deploy &lt;prod&gt; &amp; verify');
    expect(svg).not.toContain('<prod>');
  });

  it('draws the phase band with its label, lane, completed share and overrun', () => {
    const { svg } = buildGanttSvg(model());
    expect(svg).toContain('Oct 5 – Oct 16 · 50%');
    // completed share is half the band
    expect(svg).toContain('width="150"');
    // lane tint spans the two task rows below the phase row
    expect(svg).toContain(`height="${2 * 36}" fill="rgb(138, 77, 234)" fill-opacity="0.05"`);
    // overrun extension
    expect(svg).toContain('width="40"');
    expect(svg).toContain('stroke="#ef4444"');
  });

  it('puts the label beside a band that is too narrow to hold it', () => {
    const narrow = model({ phaseBands: [{ row: 0, x: 20, width: 60, progress: 0, label: 'Oct 5 – Oct 6 · 0%', overrunWidth: 0, laneRows: 0 }] });
    const { svg } = buildGanttSvg(narrow);
    // x = left column + band x + band width + gap
    expect(svg).toContain(`<text x="${400 + 20 + 60 + 8}"`);
  });

  it('marks progress, estimates, the critical path and completed bars', () => {
    const { svg } = buildGanttSvg(model());
    // progress overlay covers a quarter of the 120px bar
    expect(svg).toContain('width="30" height="26" rx="2" fill="#000000" fill-opacity="0.3"');
    expect(svg).toContain('fill="url(#h)"');
    expect(svg).toContain('stroke="#f59e0b"');
    // completed bar: one dim overlay over the full bar
    expect(svg).toContain('width="80" height="26" rx="2" fill="#000000" fill-opacity="0.2"');
  });

  it('gives blocking arrows a head and related links dashes', () => {
    const { svg } = buildGanttSvg(model());
    expect(svg).toContain('<path d="M 150 54 L 160 90" stroke="#374151" stroke-width="1" marker-end="url(#a)"/>');
    expect(svg).toContain('<path d="M 10 54 L 20 90" stroke="#2563eb" stroke-width="1" stroke-dasharray="2 3"/>');
  });

  it('colours conflict and critical-path arrows from its own palette', () => {
    const { svg } = buildGanttSvg(
      model({ arrows: [{ d: 'M 1 1 L 2 2', tone: 'conflict' }, { d: 'M 3 3 L 4 4', tone: 'critical' }] }),
    );
    expect(svg).toContain('<path d="M 1 1 L 2 2" stroke="#ef4444" stroke-width="1" marker-end="url(#a)"/>');
    expect(svg).toContain('<path d="M 3 3 L 4 4" stroke="#f59e0b" stroke-width="1" marker-end="url(#a)"/>');
  });

  it('omits the today line when today is outside the range', () => {
    expect(buildGanttSvg(model()).svg).toContain('stroke-dasharray="4 3"');
    expect(buildGanttSvg(model({ todayX: null })).svg).not.toContain('stroke-dasharray="4 3"');
  });
});

describe('resolveCssColor', () => {
  it('turns a theme triplet into a concrete colour and falls back when unset', () => {
    document.documentElement.style.setProperty('--color-primary-500', '138 77 234');
    expect(resolveCssColor('--color-primary-500', '#000')).toBe('rgb(138, 77, 234)');
    expect(resolveCssColor('--color-does-not-exist', '#123456')).toBe('#123456');
  });
});

describe('exportGanttImage', () => {
  function stubDownloads() {
    const clicked: { download: string; href: string }[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function click(this: HTMLAnchorElement) {
      clicked.push({ download: this.download, href: this.href });
    });
    (URL as any).createObjectURL = vi.fn(() => 'blob:mock');
    (URL as any).revokeObjectURL = vi.fn();
    return clicked;
  }

  it('falls back to an SVG download when the chart is too large for a canvas', async () => {
    const clicked = stubDownloads();
    const result = await exportGanttImage(model({ chartWidth: 20000 }), 'big-project-timeline');
    expect(result).toBe('svg');
    expect(clicked).toEqual([{ download: 'big-project-timeline.svg', href: 'blob:mock' }]);
  });

  it('rasterises a normal chart to a PNG at up to double resolution', async () => {
    const clicked = stubDownloads();
    // jsdom loads no images and has no canvas; stand in for both.
    vi.stubGlobal(
      'Image',
      class {
        onload: (() => void) | null = null;
        set src(_value: string) {
          queueMicrotask(() => this.onload?.());
        }
      },
    );
    const drawImage = vi.fn();
    const scale = vi.fn();
    const canvas = {
      width: 0,
      height: 0,
      getContext: () => ({ drawImage, scale }),
      toBlob: (done: (blob: Blob) => void) => done(new Blob(['png'], { type: 'image/png' })),
    };
    const createElement = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation(((tag: string) =>
      tag === 'canvas' ? (canvas as unknown as HTMLElement) : createElement(tag)) as typeof document.createElement);

    const result = await exportGanttImage(model(), 'migration-timeline');

    expect(result).toBe('png');
    expect(canvas.width).toBe(2200);
    expect(scale).toHaveBeenCalledWith(2, 2);
    expect(drawImage).toHaveBeenCalledTimes(1);
    expect(clicked).toEqual([{ download: 'migration-timeline.png', href: 'blob:mock' }]);
    vi.unstubAllGlobals();
  });

  it('reports a failure when the image cannot be rendered', async () => {
    stubDownloads();
    vi.stubGlobal(
      'Image',
      class {
        onerror: (() => void) | null = null;
        set src(_value: string) {
          queueMicrotask(() => this.onerror?.());
        }
      },
    );
    await expect(exportGanttImage(model(), 'x')).rejects.toThrow('Timeline image failed to render');
    vi.unstubAllGlobals();
  });
});
