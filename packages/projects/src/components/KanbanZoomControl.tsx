'use client';

import { Minus, Plus } from 'lucide-react';
import { Button } from '@alga-psa/ui/components/Button';

interface KanbanZoomControlProps {
  zoomLevel: number;
  onZoomChange: (level: number) => void;
  minZoom?: number;
  maxZoom?: number;
  step?: number;
}

/**
 * Zoom control for kanban board column width
 * Default zoom range: 0 (compact) to 100 (spacious)
 * Default (50) = 350px column width
 */
export const KanbanZoomControl: React.FC<KanbanZoomControlProps> = ({
  zoomLevel,
  onZoomChange,
  minZoom = 0,
  maxZoom = 100,
  step = 10,
}) => {
  const handleZoomOut = () => {
    const newLevel = Math.max(minZoom, zoomLevel - step);
    onZoomChange(newLevel);
  };

  const handleZoomIn = () => {
    const newLevel = Math.min(maxZoom, zoomLevel + step);
    onZoomChange(newLevel);
  };

  const isMinZoom = zoomLevel <= minZoom;
  const isMaxZoom = zoomLevel >= maxZoom;

  return (
    <div className="flex items-center gap-1.5">
      <span className="text-xs text-gray-500 mr-0.5">Compact</span>
      <Button
        id="kanban-zoom-out"
        variant="outline"
        size="xs"
        onClick={handleZoomOut}
        disabled={isMinZoom}
        title="Decrease column width"
        className="!w-6 !h-6 !p-0 !min-w-0"
      >
        <Minus className="w-3.5 h-3.5" />
      </Button>
      <Button
        id="kanban-zoom-in"
        variant="outline"
        size="xs"
        onClick={handleZoomIn}
        disabled={isMaxZoom}
        title="Increase column width"
        className="!w-6 !h-6 !p-0 !min-w-0"
      >
        <Plus className="w-3.5 h-3.5" />
      </Button>
      <span className="text-xs text-gray-500 ml-0.5">Spacious</span>
    </div>
  );
};

/**
 * Calculate column width based on zoom level
 * @param zoomLevel - Value from 0 (compact) to 100 (spacious)
 * @returns Column width in pixels
 */
export const calculateColumnWidth = (zoomLevel: number): number => {
  // At zoom 0: 220px (compact)
  // At zoom 50: 350px (default)
  // At zoom 100: 480px (spacious)
  const MIN_WIDTH = 220;
  const RANGE = 260; // 480 - 220
  return Math.round(MIN_WIDTH + (zoomLevel / 100) * RANGE);
};

export default KanbanZoomControl;
