import { DEFAULT_INVOICE_PRINT_SETTINGS, resolveTemplatePrintSettings } from '@alga-psa/types';

const DEFAULT_RESOLVED_PRINT_SETTINGS = resolveTemplatePrintSettings({
  printSettings: DEFAULT_INVOICE_PRINT_SETTINGS,
});

export const DESIGNER_CANVAS_WIDTH = DEFAULT_RESOLVED_PRINT_SETTINGS.pageWidthPx;
export const DESIGNER_CANVAS_HEIGHT = DEFAULT_RESOLVED_PRINT_SETTINGS.pageHeightPx;

export const DESIGNER_CANVAS_BOUNDS = {
  width: DESIGNER_CANVAS_WIDTH,
  height: DESIGNER_CANVAS_HEIGHT,
};
