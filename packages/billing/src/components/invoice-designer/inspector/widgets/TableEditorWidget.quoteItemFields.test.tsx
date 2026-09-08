// @vitest-environment jsdom

/**
 * Regression: the quote line-item row carries the catalog name and the line's
 * own description in separate fields, so the table inspector has to offer both.
 * Its binding-key suggestions come from the collection descriptor, which listed
 * `description` only — a designer opening the Grouped layout had no way to bind
 * a Name column without typing the key from memory.
 */
import React from 'react';
import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@alga-psa/ui/hooks/useFeatureFlag', () => ({
  useFeatureFlag: () => ({ enabled: true, loading: false, error: null }),
}));

vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key,
  }),
  useFormatters: () => ({
    formatCurrency: (value: number) => `$${value}`,
    formatDate: (value: string) => value,
  }),
}));

vi.mock('@alga-psa/ui/components/CustomSelect', () => ({
  default: ({ id, value, options, onValueChange }: any) => (
    <select
      id={id}
      data-automation-id={id}
      value={value}
      onChange={(event) => onValueChange(event.target.value)}
    >
      {(options ?? []).map((option: any) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  ),
}));

import type { TemplateAst } from '@alga-psa/types';
import { getStandardQuoteTemplateAstByCode } from '../../../../lib/quote-template-ast/standardTemplates';
import { importTemplateAstToWorkspace } from '../../ast/workspaceAst';
import { useInvoiceDesignerStore } from '../../state/designerStore';
import { TableEditorWidget } from './TableEditorWidget';

const TABLE_ID = 'monthly-items';

const TableEditorHarness: React.FC = () => {
  const node = useInvoiceDesignerStore((state) => state.nodes.find((entry) => entry.id === TABLE_ID));
  if (!node) return null;
  return <TableEditorWidget node={node} />;
};

const loadGroupedQuoteLayout = () => {
  const ast = getStandardQuoteTemplateAstByCode('standard-quote-grouped') as TemplateAst;
  expect(ast).toBeTruthy();
  useInvoiceDesignerStore.getState().loadWorkspace(importTemplateAstToWorkspace(ast) as any);
};

afterEach(() => {
  cleanup();
});

describe('TableEditorWidget quote line-item fields', () => {
  beforeEach(() => {
    useInvoiceDesignerStore.getState().resetWorkspace();
  });

  it('offers the catalog item name alongside the description', () => {
    loadGroupedQuoteLayout();
    const { container } = render(<TableEditorHarness />);

    const keys = Array.from(container.querySelectorAll('code'), (node) => node.textContent);
    expect(keys).toContain('item.service_name');
    expect(keys).toContain('item.description');
    expect(keys).toContain('item.total_price');
  });
});
