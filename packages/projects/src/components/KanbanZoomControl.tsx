'use client';

import ViewDensityControl from '@alga-psa/ui/components/ViewDensityControl';

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
  return (
    <ViewDensityControl
      idPrefix="kanban"
      compactId="kanban-snap-compact"
      decreaseId="kanban-zoom-out"
      resetId="kanban-zoom-reset"
      increaseId="kanban-zoom-in"
      spaciousId="kanban-snap-spacious"
      value={zoomLevel}
      onChange={onZoomChange}
      minValue={minZoom}
      maxValue={maxZoom}
      step={step}
      compactLabel="Compact"
      spaciousLabel="Spacious"
      decreaseTitle="Decrease column width"
      increaseTitle="Increase column width"
      resetTitle="Reset to default"
    />
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
