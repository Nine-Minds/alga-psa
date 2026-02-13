import type { CSSProperties } from 'react';

import type { DesignerContainerLayout, DesignerNodeStyle } from '../state/designerStore';

export const resolveContainerLayoutStyle = (layout?: DesignerContainerLayout): CSSProperties => {
  if (!layout) {
    return {};
  }

  const style: CSSProperties = {
    display: layout.display,
    gap: layout.gap,
    padding: layout.padding,
  };

  if (layout.display === 'flex') {
    style.flexDirection = layout.flexDirection;
    style.justifyContent = layout.justifyContent;
    style.alignItems = layout.alignItems;
  }

  if (layout.display === 'grid') {
    style.gridTemplateColumns = layout.gridTemplateColumns;
    style.gridTemplateRows = layout.gridTemplateRows;
    style.gridAutoFlow = layout.gridAutoFlow;
  }

  return style;
};

export const resolveNodeBoxStyle = (nodeStyle?: DesignerNodeStyle): CSSProperties => {
  if (!nodeStyle) {
    return {};
  }

  return {
    width: nodeStyle.width,
    height: nodeStyle.height,
    minWidth: nodeStyle.minWidth,
    minHeight: nodeStyle.minHeight,
    maxWidth: nodeStyle.maxWidth,
    maxHeight: nodeStyle.maxHeight,

    flexGrow: nodeStyle.flexGrow,
    flexShrink: nodeStyle.flexShrink,
    flexBasis: nodeStyle.flexBasis,

    // Media helpers (applies to replaced elements like <img>, but harmless on a wrapper div).
    aspectRatio: nodeStyle.aspectRatio,
    objectFit: nodeStyle.objectFit,
  };
};

