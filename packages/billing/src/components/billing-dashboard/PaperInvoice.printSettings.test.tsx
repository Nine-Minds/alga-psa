// @vitest-environment jsdom

import React from 'react';
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { millimetersToPixels, type InvoiceTemplateAst } from '@alga-psa/types';

import PaperInvoice from './PaperInvoice';

afterEach(() => cleanup());

const buildTemplateAst = ({
  paperPreset,
  marginMm,
  widthPx,
  heightPx,
  paddingPx,
}: {
  paperPreset?: 'Letter' | 'A4' | 'Legal';
  marginMm?: number;
  widthPx: number;
  heightPx: number;
  paddingPx: number;
}): InvoiceTemplateAst => ({
  kind: 'invoice-template-ast',
  version: 1,
  metadata: paperPreset && typeof marginMm === 'number' ? { printSettings: { paperPreset, marginMm } } : undefined,
  layout: {
    id: 'document-root',
    type: 'document',
    style: {
      inline: {
        width: `${widthPx}px`,
        height: `${heightPx}px`,
      },
    },
    children: [
      {
        id: 'page-root',
        type: 'section',
        style: {
          inline: {
            width: `${widthPx}px`,
            height: `${heightPx}px`,
            padding: `${paddingPx}px`,
          },
        },
        children: [],
      },
    ],
  },
});

describe('PaperInvoice print settings', () => {
  it('does not fall back to the old fixed shell dimensions when explicit print settings are present', () => {
    const templateAst = buildTemplateAst({
      paperPreset: 'A4',
      marginMm: 12,
      widthPx: 794,
      heightPx: 1123,
      paddingPx: 45,
    });

    render(
      <PaperInvoice templateAst={templateAst}>
        <div>Preview</div>
      </PaperInvoice>
    );

    const sheet = document.querySelector('[data-automation-id="paper-invoice-sheet"]') as HTMLElement | null;
    expect(sheet).toBeTruthy();
    expect(sheet?.style.width).toBe('794px');
    expect(sheet?.style.minHeight).toBe('1123px');
    expect(sheet?.style.width).not.toBe('800px');
  });

  it('reflects the selected Letter preset and margin in the preview shell', () => {
    const marginMm = 14;
    const templateAst = buildTemplateAst({
      paperPreset: 'Letter',
      marginMm,
      widthPx: 816,
      heightPx: 1056,
      paddingPx: Math.round(millimetersToPixels(marginMm)),
    });

    render(
      <PaperInvoice templateAst={templateAst}>
        <div>Preview</div>
      </PaperInvoice>
    );

    const sheet = document.querySelector('[data-automation-id="paper-invoice-sheet"]') as HTMLElement | null;
    expect(sheet?.getAttribute('data-paper-preset')).toBe('Letter');
    expect(sheet?.style.width).toBe('816px');
    expect(sheet?.style.getPropertyValue('--paper-printable-inset')).toBe(`${Math.round(millimetersToPixels(marginMm))}px`);
  });

  it('reflects the selected A4 preset and margin in the preview shell', () => {
    const marginMm = 12;
    const templateAst = buildTemplateAst({
      paperPreset: 'A4',
      marginMm,
      widthPx: 794,
      heightPx: 1123,
      paddingPx: Math.round(millimetersToPixels(marginMm)),
    });

    render(
      <PaperInvoice templateAst={templateAst}>
        <div>Preview</div>
      </PaperInvoice>
    );

    const sheet = document.querySelector('[data-automation-id="paper-invoice-sheet"]') as HTMLElement | null;
    expect(sheet?.getAttribute('data-paper-preset')).toBe('A4');
    expect(sheet?.style.width).toBe('794px');
    expect(sheet?.style.getPropertyValue('--paper-printable-inset')).toBe(`${Math.round(millimetersToPixels(marginMm))}px`);
  });

  it('infers preview shell sizing for legacy templates without explicit print metadata', () => {
    const templateAst = buildTemplateAst({
      widthPx: 794,
      heightPx: 1123,
      paddingPx: 40,
    });

    render(
      <PaperInvoice templateAst={templateAst}>
        <div>Preview</div>
      </PaperInvoice>
    );

    const sheet = document.querySelector('[data-automation-id="paper-invoice-sheet"]') as HTMLElement | null;
    expect(sheet?.getAttribute('data-paper-preset')).toBe('A4');
    expect(sheet?.style.width).toBe('794px');
    expect(sheet?.style.getPropertyValue('--paper-printable-inset')).toBe('40px');
  });
});
