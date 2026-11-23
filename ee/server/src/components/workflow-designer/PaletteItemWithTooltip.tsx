'use client';

import React from 'react';
import type { DraggableProvided } from '@hello-pangea/dnd';
import {
  DesignerPaletteTile,
  PaletteLayoutContext,
} from '@alga-psa/ui/components/designer';

export { PaletteLayoutContext };

export type PaletteTooltipItem = {
  id: string;
  label: string;
  description: string;
  type: string;
  actionId?: string;
  actionVersion?: number;
  groupKey?: string;
  iconToken?: string;
  tileKind?: 'core-object' | 'transform' | 'app' | 'ai';
};

/** The shared palette tile, bound to @hello-pangea/dnd's prop bags and the workflow ids. */
export const PaletteItemWithTooltip: React.FC<{
  item: PaletteTooltipItem;
  icon: React.ReactNode;
  isDragging: boolean;
  provided: DraggableProvided;
  disabled?: boolean;
  onClick: () => void;
}> = ({ item, icon, isDragging, provided, disabled = false, onClick }) => (
  <DesignerPaletteTile
    item={item}
    elementId={`workflow-designer-add-${item.id}`}
    icon={icon}
    isDragging={isDragging}
    disabled={disabled}
    onClick={onClick}
    drag={{
      innerRef: provided.innerRef as (node: HTMLDivElement | null) => void,
      containerProps: provided.draggableProps as unknown as Record<string, unknown>,
      handleProps: provided.dragHandleProps as unknown as Record<string, unknown> | null,
    }}
  />
);
