/** @vitest-environment jsdom */

import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FieldWarnings } from './FieldWarnings';

vi.mock('../lib/i18n/client', () => ({
  useTranslation: () => ({
    t: (_key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? '',
  }),
}));

describe('FieldWarnings', () => {
  afterEach(cleanup);

  it('renders warnings independently of an input', () => {
    render(<FieldWarnings warnings={['Check this value', 'Confirm with the client']} />);

    expect(screen.getByText('Check this value')).toBeTruthy();
    expect(screen.getByText('Confirm with the client')).toBeTruthy();
  });

  it('dismisses the current warnings and notifies the caller', () => {
    const onDismiss = vi.fn();
    render(<FieldWarnings warnings={['Check this value']} onDismiss={onDismiss} />);

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));

    expect(screen.queryByText('Check this value')).toBeNull();
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it('shows a new warning after the previous warning was dismissed', () => {
    const { rerender } = render(<FieldWarnings warnings={['First warning']} />);
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));

    rerender(<FieldWarnings warnings={['Second warning']} />);

    expect(screen.getByText('Second warning')).toBeTruthy();
  });
});
