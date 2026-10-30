/* @vitest-environment jsdom */

import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MAX_LABELS_PER_REQUEST } from '@alga-psa/types';

import BulkTicketActionBar from './BulkTicketActionBar';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, def?: any, opts?: Record<string, unknown>) => {
      let text = typeof def === 'string' ? def : String(def?.defaultValue ?? key);
      for (const [k, v] of Object.entries(opts ?? {})) text = text.replace(`{{${k}}}`, String(v));
      return text;
    },
  }),
}));
vi.mock('@alga-psa/ui/components/BulkActionBar', () => ({
  BulkActionBar: ({ actions = [], idPrefix }: any) => (
    <div>
      {actions.map((a: any) => (
        <button key={a.id} id={`${idPrefix}-${a.id}-button`} disabled={a.disabled} title={a.title} onClick={a.onClick}>
          {a.label}
        </button>
      ))}
    </div>
  ),
}));

function renderBar(count: number, onPrintLabels = vi.fn()) {
  const noop = vi.fn();
  render(
    <BulkTicketActionBar
      count={count}
      showMove={false} showBundle={false} showAssign={false} showStatus={false}
      showPriority={false} showTags={false} showDueDate={false}
      onMove={noop} onBundle={noop} onAssign={noop} onStatus={noop} onPriority={noop}
      onTags={noop} onDueDate={noop} onDelete={noop} onClear={noop}
      onPrintLabels={onPrintLabels}
    />,
  );
  return document.getElementById('ticket-bulk-action-bar-print-labels-button') as HTMLButtonElement;
}

describe('BulkTicketActionBar print labels', () => {
  afterEach(cleanup);

  it('limit constant is 200', () => {
    expect(MAX_LABELS_PER_REQUEST).toBe(200);
  });

  it('calls onPrintLabels when clicked', async () => {
    const onPrintLabels = vi.fn();
    const button = renderBar(3, onPrintLabels);
    expect(button.disabled).toBe(false);
    await userEvent.click(button);
    expect(onPrintLabels).toHaveBeenCalledTimes(1);
  });

  it('is enabled at exactly the limit', () => {
    expect(renderBar(MAX_LABELS_PER_REQUEST).disabled).toBe(false);
  });

  it('is disabled above the limit and does not fire', async () => {
    const onPrintLabels = vi.fn();
    const button = renderBar(MAX_LABELS_PER_REQUEST + 1, onPrintLabels);
    expect(button.disabled).toBe(true);
    expect(button.title).toContain('200');
    await userEvent.click(button);
    expect(onPrintLabels).not.toHaveBeenCalled();
  });
});
