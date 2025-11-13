import React from 'react';
import { Button } from 'server/src/components/ui/Button';
import { Switch } from 'server/src/components/ui/Switch';

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
  return (
    <div className="flex items-center justify-between border-b border-slate-200 bg-white px-4 py-2">
      <div className="flex items-center gap-3">
        <Button id="designer-toolbar-undo" variant="outline" size="sm" onClick={onUndo}>
          Undo
        </Button>
        <Button id="designer-toolbar-redo" variant="outline" size="sm" onClick={onRedo}>
          Redo
        </Button>
        <div className="flex items-center gap-2 text-sm text-slate-600">
          <Switch id="snap-toggle" checked={snapToGrid} onCheckedChange={onToggleSnap} />
          <label htmlFor="snap-toggle">Snap</label>
          <input
            type="number"
            min={2}
            max={64}
            value={gridSize}
            onChange={(event) => onGridSizeChange(Number(event.target.value))}
            className="w-16 border rounded px-1 py-0.5 text-xs"
          />
        </div>
        <div className="flex items-center gap-2 text-sm text-slate-600">
          <Switch id="guides-toggle" checked={showGuides} onCheckedChange={onToggleGuides} />
          <label htmlFor="guides-toggle">Guides</label>
        </div>
        <div className="flex items-center gap-2 text-sm text-slate-600">
          <Switch id="rulers-toggle" checked={showRulers} onCheckedChange={onToggleRulers} />
          <label htmlFor="rulers-toggle">Rulers</label>
        </div>
      </div>
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2 text-sm text-slate-600 min-w-[160px]">
          <span>Zoom</span>
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
        <div className="text-xs text-slate-500 flex flex-col">
          <span>Drags: {metrics.totalDrags}</span>
          <span>Success: {metrics.completedDrops}</span>
          <span>Invalid: {metrics.failedDrops}</span>
        </div>
      </div>
    </div>
  );
};
