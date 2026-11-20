/**
 * The designer shell: palette, canvas slot, inspector, save status, undo / redo, preview
 * modes. Nothing here knows about service requests, forms, workflows or dashboards.
 */
export { DesignerShell } from './DesignerShell';
export type { DesignerShellProps, DesignerPreviewWidth } from './DesignerShell';
export { DesignerPalette } from './DesignerPalette';
export type { DesignerPaletteItem, DesignerPaletteProps } from './DesignerPalette';
export {
  DesignerPaletteItem as DesignerPaletteTile,
  PaletteLayoutContext,
} from './DesignerPaletteItem';
export type {
  DesignerPaletteTooltipItem,
  PaletteItemDragBindings,
} from './DesignerPaletteItem';
export { DesignerSaveStatus, getDesignerSaveState, describeSavedAgo } from './DesignerSaveStatus';
export type { DesignerSaveState } from './DesignerSaveStatus';
export * from './designerDraftBackup';
export * from './designerSidebarSizing';
export * from './designerHistory';
export * from './designerPaletteSearch';
