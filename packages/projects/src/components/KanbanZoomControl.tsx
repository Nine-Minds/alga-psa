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
  const isDefaultZoom = zoomLevel === 50;

  const handleSnapToCompact = () => {
    onZoomChange(minZoom);
  };

  const handleSnapToSpacious = () => {
    onZoomChange(maxZoom);
  };

  const handleResetToDefault = () => {
    onZoomChange(50);
  };

  return (
    <div className="flex items-center gap-1.5">
      <Button
        id="kanban-snap-compact"
        variant="ghost"
        size="xs"
        onClick={handleSnapToCompact}
        disabled={isMinZoom}
        title="Snap to compact view"
        className="!h-6 !px-1 !min-w-0 text-xs text-gray-500 hover:text-gray-700 disabled:text-gray-400"
      >
        Compact
      </Button>
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
        id="kanban-zoom-reset"
        variant={isDefaultZoom ? "outline" : "ghost"}
        size="xs"
        onClick={handleResetToDefault}
        disabled={isDefaultZoom}
        title="Reset to default"
        className="!h-6 !px-1.5 !min-w-0 text-xs"
      >
        Reset
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
      <Button
        id="kanban-snap-spacious"
        variant="ghost"
        size="xs"
        onClick={handleSnapToSpacious}
        disabled={isMaxZoom}
        title="Snap to spacious view"
        className="!h-6 !px-1 !min-w-0 text-xs text-gray-500 hover:text-gray-700 disabled:text-gray-400"
      >
        Spacious
      </Button>
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

/**
 * Zoom scale configuration for various UI elements
 * Returns multipliers relative to default (zoom 50 = 1.0)
 */
export interface ZoomScales {
  padding: number;      // Card padding multiplier
  gap: number;          // Gap between cards multiplier
  fontSize: number;     // Font size multiplier
  iconSize: number;     // Icon size multiplier
  titleSize: string;    // Tailwind class for title
  descSize: string;     // Tailwind class for description
  metaSize: string;     // Tailwind class for metadata
  cardPadding: string;  // Tailwind class for card padding
  cardGap: string;      // Tailwind class for gap between elements
  showDescription: boolean; // Whether to show description
}

/**
 * Calculate zoom scales based on zoom level
 * @param zoomLevel - Value from 0 (compact) to 100 (spacious)
 * @returns ZoomScales object with various size multipliers
 */
export const calculateZoomScales = (zoomLevel: number): ZoomScales => {
  // Scale factor: 0.7 at zoom 0, 1.0 at zoom 50, 1.3 at zoom 100
  const scale = 0.7 + (zoomLevel / 100) * 0.6;

  // Determine size classes based on zoom level
  let titleSize: string;
  let descSize: string;
  let metaSize: string;
  let cardPadding: string;
  let cardGap: string;
  let showDescription: boolean;

  if (zoomLevel <= 15) {
    // Very compact
    titleSize = 'text-sm';
    descSize = 'text-xs';
    metaSize = 'text-[10px]';
    cardPadding = 'p-1.5';
    cardGap = 'gap-0.5';
    showDescription = false;
  } else if (zoomLevel <= 30) {
    // Compact
    titleSize = 'text-base';
    descSize = 'text-sm';
    metaSize = 'text-xs';
    cardPadding = 'p-2';
    cardGap = 'gap-0.5';
    showDescription = true;
  } else if (zoomLevel <= 70) {
    // Default / Normal range (wider range for consistent look)
    titleSize = 'text-lg';
    descSize = 'text-sm';
    metaSize = 'text-xs';
    cardPadding = 'p-3';
    cardGap = 'gap-1';
    showDescription = true;
  } else {
    // Spacious
    titleSize = 'text-xl';
    descSize = 'text-base';
    metaSize = 'text-sm';
    cardPadding = 'p-4';
    cardGap = 'gap-2';
    showDescription = true;
  }

  return {
    padding: scale,
    gap: scale,
    fontSize: scale,
    iconSize: scale,
    titleSize,
    descSize,
    metaSize,
    cardPadding,
    cardGap,
    showDescription,
  };
};

/**
 * Calculate gap between cards based on zoom level
 * @param zoomLevel - Value from 0 (compact) to 100 (spacious)
 * @returns Gap in pixels
 */
export const calculateCardGap = (zoomLevel: number): number => {
  // At zoom 0: 4px
  // At zoom 50: 8px (default)
  // At zoom 100: 12px
  return Math.round(4 + (zoomLevel / 100) * 8);
};

export default KanbanZoomControl;
