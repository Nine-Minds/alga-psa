import { describe, expect, it } from 'vitest';

import type { DesignerNode } from '../state/designerStore';
import {
  isColumnHeaderTranslatable,
  isNodeLabelTranslatable,
  isNodeTextTranslatable,
} from './translatableText';

const nodeWithMetadata = (metadata: Record<string, unknown>, type = 'field'): DesignerNode =>
  ({
    id: 'node-1',
    type,
    props: { metadata },
    position: { x: 0, y: 0 },
    size: { width: 1, height: 1 },
    parentId: null,
    children: [],
    allowedChildren: [],
  }) as unknown as DesignerNode;

const labelRef = { i18nKey: 'labels.quoteNumber', defaultValue: 'Quote #' };

describe('isNodeLabelTranslatable', () => {
  it('marks a label that still matches its imported key reference', () => {
    expect(
      isNodeLabelTranslatable(nodeWithMetadata({ label: 'Quote #', __astLabelI18n: labelRef }))
    ).toBe(true);
  });

  it('unmarks a label the author replaced with their own text', () => {
    expect(
      isNodeLabelTranslatable(nodeWithMetadata({ label: 'Our reference', __astLabelI18n: labelRef }))
    ).toBe(false);
  });

  it('never marks a label that has no key reference', () => {
    expect(isNodeLabelTranslatable(nodeWithMetadata({ label: 'Quote #' }))).toBe(false);
  });
});

describe('isNodeTextTranslatable', () => {
  const i18nExpression = { type: 'i18n', i18nKey: 'labels.quoteTitle', defaultValue: 'QUOTE' };

  it('marks a text node whose content still matches the imported preview text', () => {
    expect(
      isNodeTextTranslatable(
        nodeWithMetadata(
          { text: 'QUOTE', astContentExpression: i18nExpression, __astContentPreviewText: 'QUOTE' },
          'text'
        )
      )
    ).toBe(true);
  });

  it('unmarks a text node the author rewrote', () => {
    expect(
      isNodeTextTranslatable(
        nodeWithMetadata(
          { text: 'OFFER', astContentExpression: i18nExpression, __astContentPreviewText: 'QUOTE' },
          'text'
        )
      )
    ).toBe(false);
  });

  it('never marks literal or binding content', () => {
    expect(
      isNodeTextTranslatable(
        nodeWithMetadata(
          { text: 'QUOTE', astContentExpression: { type: 'literal', value: 'QUOTE' }, __astContentPreviewText: 'QUOTE' },
          'text'
        )
      )
    ).toBe(false);
  });
});

describe('isColumnHeaderTranslatable', () => {
  const headerRef = { i18nKey: 'labels.description', defaultValue: 'Description' };

  it('marks a header that still matches its key reference and unmarks edits', () => {
    expect(isColumnHeaderTranslatable({ header: 'Description', __astHeaderI18n: headerRef })).toBe(true);
    expect(isColumnHeaderTranslatable({ header: 'Line item', __astHeaderI18n: headerRef })).toBe(false);
    expect(isColumnHeaderTranslatable({ header: 'Description' })).toBe(false);
  });
});
