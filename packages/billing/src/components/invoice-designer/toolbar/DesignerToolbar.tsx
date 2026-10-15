import React from 'react';
import { Button } from '@alga-psa/ui/components/Button';
import { Switch } from '@alga-psa/ui/components/Switch';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

export const ZOOM_MIN = 0.5;
export const ZOOM_MAX = 2;
const ZOOM_STEPS = [0.5, 0.6, 0.7, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2];

/** The next preset zoom level in `direction` from `scale`. */
export const stepZoom = (scale: number, direction: 1 | -1): number => {
  const next = direction > 0
    ? ZOOM_STEPS.find((step) => step > scale + 0.001)
    : [...ZOOM_STEPS].reverse().find((step) => step < scale - 0.001);
  return next ?? (direction > 0 ? ZOOM_MAX : ZOOM_MIN);
};

interface DesignerToolbarProps {
  snapToGrid: boolean;
  showGuides: boolean;
  showRulers: boolean;
  canvasScale: number;
  gridSize: number;
  metrics: {
    totalDrags: number;
    completedDrops: number;
    failedDrops: number;
  };
  onToggleSnap: () => void;
  onToggleGuides: () => void;
  onToggleRulers: () => void;
  onZoomChange: (value: number) => void;
  /** Zooms so the page width fits the canvas. */
  onZoomToFit: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onGridSizeChange: (value: number) => void;
}

export const DesignerToolbar: React.FC<DesignerToolbarProps> = ({
  snapToGrid,
  showGuides,
  showRulers,
  canvasScale,
  gridSize,
  metrics,
  onToggleSnap,
  onToggleGuides,
  onToggleRulers,
  onZoomChange,
  onZoomToFit,
  onUndo,
  onRedo,
  onGridSizeChange,
}) => {
  const { t } = useTranslation('msp/invoicing');
  return (
    <div className="flex items-center justify-between border-b border-slate-200 dark:border-[rgb(var(--color-border-200))] bg-white dark:bg-[rgb(var(--color-card))] px-4 py-2">
      <div className="flex items-center gap-3">
        <Button id="designer-toolbar-undo" variant="outline" size="sm" onClick={onUndo}>
          {t('designer.toolbar.undo', { defaultValue: 'Undo' })}
        </Button>
        <Button id="designer-toolbar-redo" variant="outline" size="sm" onClick={onRedo}>
          {t('designer.toolbar.redo', { defaultValue: 'Redo' })}
        </Button>
        <div className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-400">
          <Switch id="snap-toggle" checked={snapToGrid} onCheckedChange={onToggleSnap} />
          <label htmlFor="snap-toggle">{t('designer.toolbar.snap', { defaultValue: 'Snap' })}</label>
          <input
            type="number"
            min={2}
            max={64}
            value={gridSize}
            onChange={(event) => onGridSizeChange(Number(event.target.value))}
            className="w-16 border border-slate-200 dark:border-slate-600 rounded px-1 py-0.5 text-xs bg-white dark:bg-[rgb(var(--color-background))] dark:text-slate-300"
          />
        </div>
        <div className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-400">
          <Switch id="guides-toggle" checked={showGuides} onCheckedChange={onToggleGuides} />
          <label htmlFor="guides-toggle">{t('designer.toolbar.guides', { defaultValue: 'Guides' })}</label>
        </div>
        <div className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-400">
          <Switch id="rulers-toggle" checked={showRulers} onCheckedChange={onToggleRulers} />
          <label htmlFor="rulers-toggle">{t('designer.toolbar.rulers', { defaultValue: 'Rulers' })}</label>
        </div>
      </div>
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-1.5 text-sm text-slate-600 dark:text-slate-400 min-w-[160px]">
          <span>{t('designer.toolbar.zoom', { defaultValue: 'Zoom' })}</span>
          <Button
            id="designer-zoom-out"
            variant="outline"
            size="sm"
            className="h-7 w-7 p-0"
            onClick={() => onZoomChange(stepZoom(canvasScale, -1))}
            disabled={canvasScale <= ZOOM_MIN}
            aria-label={t('designer.toolbar.zoomOut', { defaultValue: 'Zoom out' })}
          >
            −
          </Button>
          <input
            type="range"
            min={ZOOM_MIN * 100}
            max={ZOOM_MAX * 100}
            step={5}
            value={Math.round(canvasScale * 100)}
            onChange={(event) => onZoomChange(Number(event.target.value) / 100)}
            className="w-24"
            aria-label={t('designer.toolbar.zoom', { defaultValue: 'Zoom' })}
          />
          <Button
            id="designer-zoom-in"
            variant="outline"
            size="sm"
            className="h-7 w-7 p-0"
            onClick={() => onZoomChange(stepZoom(canvasScale, 1))}
            disabled={canvasScale >= ZOOM_MAX}
            aria-label={t('designer.toolbar.zoomIn', { defaultValue: 'Zoom in' })}
          >
            +
          </Button>
          <span className="min-w-12 whitespace-nowrap text-right tabular-nums">{Math.round(canvasScale * 100)}%</span>
          <Button id="designer-zoom-fit" variant="outline" size="sm" className="h-7 px-2" onClick={onZoomToFit}>
            {t('designer.toolbar.zoomFit', { defaultValue: 'Fit' })}
          </Button>
        </div>
        <div className="text-xs text-slate-500 dark:text-slate-400 flex flex-col">
          <span>{t('designer.toolbar.metrics.drags', { defaultValue: 'Drags: {{count}}', count: metrics.totalDrags })}</span>
          <span>{t('designer.toolbar.metrics.success', { defaultValue: 'Success: {{count}}', count: metrics.completedDrops })}</span>
          <span>{t('designer.toolbar.metrics.invalid', { defaultValue: 'Invalid: {{count}}', count: metrics.failedDrops })}</span>
        </div>
      </div>
    </div>
  );
};
