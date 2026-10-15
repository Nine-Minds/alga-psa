import React from 'react';

export type RulerSpan = { start: number; end: number };

type CanvasRulersProps = {
  /** Page size in designer px. */
  width: number;
  height: number;
  canvasScale: number;
  /** Extent of the selected block in designer px, highlighted on both rulers. */
  selection: { x: RulerSpan; y: RulerSpan } | null;
};

const RULER_PX = 20;

const resolveSteps = (scale: number) => {
  // Keep labels at least ~36 screen px apart and minor ticks at least ~6 px apart.
  const labelStep = [50, 100, 200].find((step) => step * scale >= 36) ?? 200;
  const minorStep = [10, 25, 50].find((step) => step * scale >= 6) ?? 50;
  return { labelStep, minorStep };
};

const ticks = (length: number, step: number) =>
  Array.from({ length: Math.floor(length / step) + 1 }, (_, index) => index * step);

/**
 * Rulers in designer px, aligned with the page and scaled with the zoom, so a reading
 * on the ruler is the size the block has in the document. Drawn just outside the page
 * edge; the top ruler stays in view while the canvas scrolls.
 */
export const CanvasRulers: React.FC<CanvasRulersProps> = ({ width, height, canvasScale, selection }) => {
  const { labelStep, minorStep } = resolveSteps(canvasScale);
  const scaledWidth = width * canvasScale;
  const scaledHeight = height * canvasScale;

  return (
    <>
      <div className="pointer-events-none sticky z-30 h-0" style={{ top: RULER_PX }} aria-hidden>
        <div
          className="absolute left-0 overflow-hidden border-b border-slate-300 bg-white/95 text-[10px] text-slate-500 dark:border-slate-600 dark:bg-[rgb(var(--color-card))] dark:text-slate-400"
          style={{ top: -RULER_PX, width: scaledWidth, height: RULER_PX }}
          data-automation-id="designer-ruler-horizontal"
        >
          {selection && (
            <div
              className="absolute top-0 h-full bg-primary-500/15"
              style={{ left: selection.x.start * canvasScale, width: (selection.x.end - selection.x.start) * canvasScale }}
            />
          )}
          {ticks(width, minorStep).map((value) => (
            <div
              key={value}
              className="absolute bottom-0 w-px bg-slate-300 dark:bg-slate-600"
              style={{ left: value * canvasScale, height: value % labelStep === 0 ? RULER_PX : 5 }}
            >
              {value % labelStep === 0 && <span className="absolute left-1 top-0.5 whitespace-nowrap">{value}</span>}
            </div>
          ))}
        </div>
      </div>
      <div
        className="pointer-events-none absolute top-0 overflow-hidden border-r border-slate-300 bg-white/95 text-[10px] text-slate-500 dark:border-slate-600 dark:bg-[rgb(var(--color-card))] dark:text-slate-400"
        style={{ left: -RULER_PX, width: RULER_PX, height: scaledHeight }}
        aria-hidden
        data-automation-id="designer-ruler-vertical"
      >
        {selection && (
          <div
            className="absolute left-0 w-full bg-primary-500/15"
            style={{ top: selection.y.start * canvasScale, height: (selection.y.end - selection.y.start) * canvasScale }}
          />
        )}
        {ticks(height, minorStep).map((value) => (
          <div
            key={value}
            className="absolute right-0 h-px bg-slate-300 dark:bg-slate-600"
            style={{ top: value * canvasScale, width: value % labelStep === 0 ? RULER_PX : 5 }}
          >
            {value % labelStep === 0 && (
              <span className="absolute left-1 top-1 whitespace-nowrap" style={{ writingMode: 'vertical-rl' }}>
                {value}
              </span>
            )}
          </div>
        ))}
      </div>
    </>
  );
};
