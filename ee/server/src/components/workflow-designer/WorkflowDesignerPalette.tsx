import React from 'react';
import type { DroppableProvidedProps } from '@hello-pangea/dnd';
import {
  DesignerPalette,
  type DesignerPaletteItem,
  type DesignerPaletteProps,
} from '@alga-psa/ui/components/designer';

export type WorkflowDesignerPaletteItem = DesignerPaletteItem;

type WorkflowDesignerPaletteProps<TItem extends WorkflowDesignerPaletteItem> = Omit<
  DesignerPaletteProps<TItem>,
  'i18nNamespace' | 'idPrefix' | 'scrollContainerProps' | 'header'
> & {
  scrollContainerProps?: DroppableProvidedProps;
};

/** The shared designer palette, bound to the workflow designer's namespace and element ids. */
export function WorkflowDesignerPalette<TItem extends WorkflowDesignerPaletteItem>(
  props: WorkflowDesignerPaletteProps<TItem>
): React.ReactElement {
  return (
    <DesignerPalette
      {...props}
      i18nNamespace="msp/workflows"
      idPrefix="workflow-designer"
      scrollContainerProps={props.scrollContainerProps as Record<string, unknown> | undefined}
    />
  );
}
