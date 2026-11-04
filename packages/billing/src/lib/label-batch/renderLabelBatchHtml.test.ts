import { describe, expect, it } from 'vitest';
import { recordUrl, type LabelViewModel } from '@alga-psa/types';

import { LabelRenderError, renderLabelBatchHtml, type LabelPrintItem } from './renderLabelBatchHtml';
import {
  STANDARD_LABEL_ASSET_CODE,
  STANDARD_LABEL_ASSET_CODE128_CODE,
} from '../label-template-ast/standardTemplates';

const BASE = 'https://psa.example.com';
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const RMM_TAG = 'levelio:Z2lkOi8vbGV2ZWwvRGV2aWNlLzkwMDE'; // 39 chars, over the ~29-char Code 128 limit

const asset = (n: number, tag: string, templateCode = STANDARD_LABEL_ASSET_CODE128_CODE): LabelPrintItem => ({
  templateCode,
  viewModel: {
    labelClass: 'asset-identity',
    entityType: 'asset',
    recordId: uuid(n),
    url: recordUrl('asset', uuid(n), BASE),
    identifier: tag,
    code128Value: tag,
    title: `Laptop ${n}`,
    clientName: 'Emerald City Dental',
    detail: null,
    secondaryIdentifier: null,
    serialSuffix: null,
  } satisfies LabelViewModel,
});

const ONE_PER_PAGE = { kind: 'one-per-page', pageSize: { width: 4, height: 2, unit: 'in' } } as const;

async function failureOf(items: LabelPrintItem[]): Promise<LabelRenderError> {
  try {
    await renderLabelBatchHtml(items, ONE_PER_PAGE);
  } catch (error) {
    if (error instanceof LabelRenderError) return error;
    throw error;
  }
  throw new Error('expected the batch to be refused');
}

describe('renderLabelBatchHtml failures', () => {
  it('names EVERY record a Code 128 batch cannot print, with the QR-only template as the way out', async () => {
    const error = await failureOf([asset(1, RMM_TAG), asset(2, 'WL-WS-001'), asset(3, `${RMM_TAG}X`)]);
    expect(error.failures.map((f) => [f.index, f.recordId, f.identifier])).toEqual([
      [0, uuid(1), RMM_TAG],
      [2, uuid(3), `${RMM_TAG}X`],
    ]);
    for (const failure of error.failures) {
      expect(failure.templateCode).toBe(STANDARD_LABEL_ASSET_CODE128_CODE);
      expect(failure.suggestedTemplateCode).toBe(STANDARD_LABEL_ASSET_CODE);
      expect(failure.message).toMatch(/below the 0\.25 mm minimum/);
    }
    expect(error.message).toMatch(/^2 of 3 labels cannot be printed, so none were\./);
    expect(error.message).toContain(RMM_TAG);
    expect(error.message).toMatch(/Print them with standard-asset-label instead\.$/);
  });

  it('the suggested QR-only template prints the same records', async () => {
    const { html } = await renderLabelBatchHtml(
      [asset(1, RMM_TAG, STANDARD_LABEL_ASSET_CODE), asset(3, `${RMM_TAG}X`, STANDARD_LABEL_ASSET_CODE)],
      ONE_PER_PAGE
    );
    expect(html).toContain(RMM_TAG);
  });

  it('does not suggest another template when switching would not help', async () => {
    const item = asset(1, 'WL-WS-001');
    const error = await failureOf([{ ...item, viewModel: { ...item.viewModel, url: `${item.viewModel.url}?token=x` } }]);
    expect(error.failures).toHaveLength(1);
    expect(error.failures[0].suggestedTemplateCode).toBeUndefined();
    expect(error.message).toMatch(/canonical record URL/);
  });
});
