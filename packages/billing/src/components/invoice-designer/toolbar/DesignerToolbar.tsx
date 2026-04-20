import React from 'react';
import { Button } from '@alga-psa/ui/components/Button';
import { Switch } from '@alga-psa/ui/components/Switch';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

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
        <div className="flex items-center gap-2 text-sm text-slate-600 min-w-[160px]">
          <span>{t('designer.toolbar.zoom', { defaultValue: 'Zoom' })}</span>
          <input
            type="range"
            min={50}
            max={200}
            step={10}
            value={canvasScale * 100}
            onChange={(event) => onZoomChange(Number(event.target.value) / 100)}
            className="w-28"
          />
          <span>{Math.round(canvasScale * 100)}%</span>
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
