/** @vitest-environment jsdom */

import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../WorkflowActionInputFixedPicker', () => ({
  WorkflowActionInputFixedPicker: () => null,
  WorkflowActionInputFixedMultiPicker: ({ idPrefix, values }: { idPrefix: string; values: string[] }) => (
    <div data-testid={`${idPrefix}-multi`}>{values.join(',')}</div>
  ),
}));

import { renderWorkflowCustomLiteralEditor } from '../mapping/workflowCustomLiteralEditor';

afterEach(() => cleanup());

describe('custom literal editors', () => {
  it('shows the notify-users editor for fixed recipients and the field editor for computed ones', () => {
    const editor = renderWorkflowCustomLiteralEditor('notification-recipients', {
      idPrefix: 'notify',
      value: { user_ids: ['u1'] },
      onChange: vi.fn(),
    });
    expect(editor).not.toBeNull();
    render(<>{editor}</>);
    expect(screen.getAllByText('u1').length).toBeGreaterThan(0);

    expect(renderWorkflowCustomLiteralEditor('notification-recipients', {
      idPrefix: 'notify',
      value: { user_ids: { $expr: 'vars.users' } } as never,
      onChange: vi.fn(),
    })).toBeNull();
  });

  it('shows the email recipients editor for fixed addresses', () => {
    expect(renderWorkflowCustomLiteralEditor('email-recipients', {
      idPrefix: 'to',
      value: [{ email: 'a@example.com' }],
      onChange: vi.fn(),
    })).not.toBeNull();
    expect(renderWorkflowCustomLiteralEditor('email-recipients', {
      idPrefix: 'to',
      value: { $expr: 'vars.to' },
      onChange: vi.fn(),
    })).toBeNull();
  });

  it('returns null for components it does not know', () => {
    expect(renderWorkflowCustomLiteralEditor('something-else', { idPrefix: 'x', value: {}, onChange: vi.fn() })).toBeNull();
  });
});
