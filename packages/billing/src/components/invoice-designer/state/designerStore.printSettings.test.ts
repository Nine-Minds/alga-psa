import { beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_INVOICE_PRINT_SETTINGS,
  millimetersToPixels,
  resolveTemplatePrintSettings,
} from '@alga-psa/types';
import { getNodeLayout, getNodeMetadata, getNodeStyle } from '../utils/nodeProps';
import { useInvoiceDesignerStore } from './designerStore';

describe('designerStore print settings', () => {
  beforeEach(() => {
    useInvoiceDesignerStore.getState().resetWorkspace();
  });

  it('updates document/page size, baseSize, width, height, and padding together in one logical change', () => {
    const beforeHistoryIndex = useInvoiceDesignerStore.getState().historyIndex;

    useInvoiceDesignerStore.getState().applyPrintSettings({
      paperPreset: 'A4',
      marginMm: 12,
    });

    const after = useInvoiceDesignerStore.getState();
    const documentNode = after.nodes.find((node) => node.type === 'document');
    const pageNode = after.nodes.find((node) => node.type === 'page');

    expect(after.historyIndex).toBe(beforeHistoryIndex + 1);
    expect(documentNode?.size).toEqual({ width: 794, height: 1123 });
    expect(documentNode?.baseSize).toEqual({ width: 794, height: 1123 });
    expect(getNodeStyle(documentNode!)?.width).toBe('794px');
    expect(getNodeStyle(documentNode!)?.height).toBe('1123px');
    expect(pageNode?.size).toEqual({ width: 794, height: 1123 });
    expect(pageNode?.baseSize).toEqual({ width: 794, height: 1123 });
    expect(getNodeStyle(pageNode!)?.width).toBe('794px');
    expect(getNodeStyle(pageNode!)?.height).toBe('1123px');
    expect(getNodeLayout(pageNode!)?.padding).toBe(`${Math.round(millimetersToPixels(12))}px`);
  });

  it('applies a paper preset to both hidden document and page nodes with matching geometry', () => {
    useInvoiceDesignerStore.getState().applyPrintSettings({
      paperPreset: 'Legal',
    });

    const state = useInvoiceDesignerStore.getState();
    const documentNode = state.nodes.find((node) => node.type === 'document');
    const pageNode = state.nodes.find((node) => node.type === 'page');

    expect(documentNode?.size).toEqual({ width: 816, height: 1344 });
    expect(pageNode?.size).toEqual({ width: 816, height: 1344 });
    expect(getNodeStyle(documentNode!)?.height).toBe('1344px');
    expect(getNodeStyle(pageNode!)?.height).toBe('1344px');
    expect(getNodeMetadata(documentNode!)).toMatchObject({
      printSettings: {
        paperPreset: 'Legal',
      },
    });
  });

  it('updates page layout padding when applying a new uniform margin', () => {
    useInvoiceDesignerStore.getState().applyPrintSettings({
      marginMm: 18,
    });

    const pageNode = useInvoiceDesignerStore.getState().nodes.find((node) => node.type === 'page');
    expect(getNodeLayout(pageNode!)?.padding).toBe(`${Math.round(millimetersToPixels(18))}px`);
  });

  it('bootstraps new workspaces with explicit default print settings and matching geometry', () => {
    const state = useInvoiceDesignerStore.getState();
    const expected = resolveTemplatePrintSettings({
      printSettings: DEFAULT_INVOICE_PRINT_SETTINGS,
    });
    const documentNode = state.nodes.find((node) => node.type === 'document');
    const pageNode = state.nodes.find((node) => node.type === 'page');

    expect(getNodeMetadata(documentNode!)).toMatchObject({
      printSettings: {
        paperPreset: expected.paperPreset,
        marginMm: expected.marginMm,
      },
    });
    expect(documentNode?.size).toEqual({
      width: expected.pageWidthPx,
      height: expected.pageHeightPx,
    });
    expect(pageNode?.size).toEqual({
      width: expected.pageWidthPx,
      height: expected.pageHeightPx,
    });
    expect(getNodeLayout(pageNode!)?.padding).toBe(`${expected.marginPx}px`);
  });

  it('does not append history for no-op print settings applications', () => {
    const before = useInvoiceDesignerStore.getState().historyIndex;

    useInvoiceDesignerStore.getState().applyPrintSettings({
      paperPreset: 'Letter',
      marginMm: DEFAULT_INVOICE_PRINT_SETTINGS.marginMm,
    });

    expect(useInvoiceDesignerStore.getState().historyIndex).toBe(before);
  });
});
