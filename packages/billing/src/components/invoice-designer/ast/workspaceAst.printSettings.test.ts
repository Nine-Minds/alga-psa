import { beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_INVOICE_PRINT_SETTINGS,
  INVOICE_TEMPLATE_AST_VERSION,
  millimetersToPixels,
  pixelsToMillimeters,
} from '@alga-psa/types';
import { useInvoiceDesignerStore } from '../state/designerStore';
import { exportWorkspaceToInvoiceTemplateAst, importInvoiceTemplateAstToWorkspace } from './workspaceAst';

const createLegacyAst = (options?: {
  metadata?: Record<string, unknown>;
  documentWidth?: number;
  documentHeight?: number;
  pageWidth?: number;
  pageHeight?: number;
  pagePadding?: number;
}) => ({
  kind: 'invoice-template-ast' as const,
  version: INVOICE_TEMPLATE_AST_VERSION,
  ...(options?.metadata ? { metadata: options.metadata } : {}),
  layout: {
    id: 'root',
    type: 'document' as const,
    style: {
      inline: {
        width: `${options?.documentWidth ?? 816}px`,
        height: `${options?.documentHeight ?? 1056}px`,
      },
    },
    children: [
      {
        id: 'page-wrapper',
        type: 'section' as const,
        style: {
          inline: {
            width: `${options?.pageWidth ?? 816}px`,
            height: `${options?.pageHeight ?? 1056}px`,
            padding: `${options?.pagePadding ?? 40}px`,
          },
        },
        children: [],
      },
    ],
  },
});

describe('workspaceAst print settings', () => {
  beforeEach(() => {
    useInvoiceDesignerStore.getState().resetWorkspace();
  });

  it('infers Letter print settings from legacy 816x1056 geometry and 40px page padding', () => {
    const workspace = importInvoiceTemplateAstToWorkspace(createLegacyAst() as any);
    const documentNode = workspace.nodesById['designer-document-root'];
    const pageNode = workspace.nodesById['page-wrapper'];

    expect(documentNode.props.metadata).toMatchObject({
      printSettings: {
        paperPreset: 'Letter',
        marginMm: DEFAULT_INVOICE_PRINT_SETTINGS.marginMm,
      },
    });
    expect(pageNode.props.style).toMatchObject({ width: '816px', height: '1056px' });
    expect(pageNode.props.layout).toMatchObject({ padding: '40px' });
  });

  it('recognizes known A4 page dimensions when explicit print metadata is absent', () => {
    const workspace = importInvoiceTemplateAstToWorkspace(
      createLegacyAst({
        documentWidth: 794,
        documentHeight: 1123,
        pageWidth: 794,
        pageHeight: 1123,
        pagePadding: 32,
      }) as any
    );
    const documentNode = workspace.nodesById['designer-document-root'];

    expect(documentNode.props.metadata).toMatchObject({
      printSettings: {
        paperPreset: 'A4',
        marginMm: Number(pixelsToMillimeters(32).toFixed(2)),
      },
    });
  });

  it('lets explicit print metadata win over inferred legacy width, height, and padding', () => {
    const workspace = importInvoiceTemplateAstToWorkspace(
      createLegacyAst({
        metadata: {
          printSettings: {
            paperPreset: 'A4',
            marginMm: 12,
          },
        },
      }) as any
    );
    const documentNode = workspace.nodesById['designer-document-root'];
    const pageNode = workspace.nodesById['page-wrapper'];

    expect(documentNode.props.metadata).toMatchObject({
      printSettings: {
        paperPreset: 'A4',
        marginMm: 12,
      },
    });
    expect(pageNode.props.style).toMatchObject({ width: '794px', height: '1123px' });
    expect(pageNode.props.layout).toMatchObject({
      padding: `${Math.round(millimetersToPixels(12))}px`,
    });
  });

  it('preserves explicit print metadata when exporting a designer workspace back to AST', () => {
    useInvoiceDesignerStore.getState().applyPrintSettings({
      paperPreset: 'Legal',
      marginMm: 15,
    });

    const ast = exportWorkspaceToInvoiceTemplateAst(useInvoiceDesignerStore.getState().exportWorkspace());

    expect(ast.metadata?.printSettings).toEqual({
      paperPreset: 'Legal',
      marginMm: 15,
    });
  });

  it('hydrates resolved page size and page padding from explicit print metadata', () => {
    const workspace = importInvoiceTemplateAstToWorkspace(
      createLegacyAst({
        metadata: {
          printSettings: {
            paperPreset: 'Legal',
            marginMm: 15,
          },
        },
        pageWidth: 816,
        pageHeight: 1056,
        pagePadding: 40,
      }) as any
    );
    const pageNode = workspace.nodesById['page-wrapper'];

    expect(pageNode.props.style).toMatchObject({
      width: '816px',
      height: '1344px',
    });
    expect(pageNode.props.layout).toMatchObject({
      padding: `${Math.round(millimetersToPixels(15))}px`,
    });
  });

  it('preserves unmatched legacy dimensions without persisting fallback print metadata on export', () => {
    const workspace = importInvoiceTemplateAstToWorkspace(
      createLegacyAst({
        documentWidth: 900,
        documentHeight: 1100,
        pageWidth: 900,
        pageHeight: 1100,
        pagePadding: 37,
      }) as any
    );
    const documentNode = workspace.nodesById['designer-document-root'];
    const pageNode = workspace.nodesById['page-wrapper'];

    expect(documentNode.props.metadata).not.toHaveProperty('printSettings');
    expect(pageNode.props.style).toMatchObject({ width: '900px', height: '1100px' });
    expect(pageNode.props.layout).toMatchObject({ padding: '37px' });

    const ast = exportWorkspaceToInvoiceTemplateAst(workspace);
    expect(ast.metadata?.printSettings).toBeUndefined();
    expect(ast.layout.style?.inline).toMatchObject({ width: '900px', height: '1100px' });
    expect(ast.layout.children?.[0]?.style?.inline).toMatchObject({
      width: '900px',
      height: '1100px',
      padding: '37px',
    });
  });
});
