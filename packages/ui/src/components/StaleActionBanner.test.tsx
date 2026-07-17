import { act, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { markStaleActionState } from '../lib/staleActionState';
import { StaleActionBanner } from './StaleActionBanner';

vi.mock('../lib/i18n/client', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key,
  }),
}));

describe('StaleActionBanner', () => {
  const originalLocation = window.location;
  const reload = vi.fn();

  beforeEach(() => {
    reload.mockReset();
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { reload },
    });
  });

  afterEach(() => {
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: originalLocation,
    });
  });

  it('appears when an action is stale and refreshes the page on request', () => {
    render(<StaleActionBanner />);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();

    act(() => markStaleActionState());

    expect(screen.getByRole('alert')).toHaveTextContent(
      'This page is out of date. Refresh to restore live updates and actions.',
    );

    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
