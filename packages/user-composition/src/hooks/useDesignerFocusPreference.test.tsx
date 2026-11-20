/* @vitest-environment jsdom */
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';

const getCurrentUser = vi.fn();
const getUserPreference = vi.fn();
const setUserPreference = vi.fn();

vi.mock('../actions', () => ({
  getCurrentUser: (...args: unknown[]) => getCurrentUser(...args),
  getUserPreference: (...args: unknown[]) => getUserPreference(...args),
  setUserPreference: (...args: unknown[]) => setUserPreference(...args),
}));

vi.mock('@alga-psa/ui/hooks/use-toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

import {
  DESIGNER_FOCUS_MODE_DESIGNERS,
  designerFocusModePreferenceKey,
  useDesignerFocusPreference,
  type DesignerFocusModeDesigner,
} from './useDesignerFocusPreference';
import * as hooksIndex from './index';

function Probe({
  designer,
  testId = 'probe',
}: {
  designer: DesignerFocusModeDesigner;
  testId?: string;
}) {
  const { isFocused, setFocused, toggle } = useDesignerFocusPreference(designer);
  return (
    <div>
      <span data-testid={`${testId}-state`}>{isFocused ? 'focused' : 'not-focused'}</span>
      <button id={`${testId}-toggle`} type="button" onClick={toggle}>
        toggle {testId}
      </button>
      <button id={`${testId}-off`} type="button" onClick={() => setFocused(false)}>
        off {testId}
      </button>
    </div>
  );
}

/** A promise a test resolves by hand, so a toggle can happen while the load is in flight. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolveFn) => {
    resolve = resolveFn;
  });
  return { promise, resolve };
}

describe('useDesignerFocusPreference', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    window.localStorage.clear();
    getCurrentUser.mockResolvedValue({ user_id: 'user-1' });
    getUserPreference.mockResolvedValue(null);
    setUserPreference.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  /** Lets the mount effects, the load round trip and the save debounce all settle. */
  async function settle() {
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      vi.advanceTimersByTime(600);
      await Promise.resolve();
    });
  }

  it('is unfocused when the user has no saved preference', async () => {
    render(<Probe designer="invoice_layout" />);
    await settle();

    expect(screen.getByTestId('probe-state')).toHaveTextContent('not-focused');
    expect(getUserPreference).toHaveBeenCalledWith('user-1', 'designer_focus_mode_invoice_layout');
  });

  it('is focused once the account value loads as true', async () => {
    getUserPreference.mockResolvedValue(true);
    render(<Probe designer="invoice_layout" />);

    await waitFor(() => expect(screen.getByTestId('probe-state')).toHaveTextContent('focused'));
  });

  it('is focused on mount from the local cache, before the account value loads', async () => {
    window.localStorage.setItem('designer_focus_mode_invoice_layout', 'true');
    const pending = deferred<boolean | null>();
    getUserPreference.mockReturnValue(pending.promise);

    render(<Probe designer="invoice_layout" />);

    await waitFor(() => expect(screen.getByTestId('probe-state')).toHaveTextContent('focused'));
    await act(async () => {
      pending.resolve(null);
    });
  });

  it('lets an account value of false override a cached true', async () => {
    window.localStorage.setItem('designer_focus_mode_invoice_layout', 'true');
    getUserPreference.mockResolvedValue(false);

    render(<Probe designer="invoice_layout" />);

    await waitFor(() => expect(screen.getByTestId('probe-state')).toHaveTextContent('not-focused'));
  });

  it('toggling flips the state and saves the new value under the designer key', async () => {
    render(<Probe designer="quote_layout" />);
    await settle();

    await userEvent.click(document.getElementById('probe-toggle')!);
    expect(screen.getByTestId('probe-state')).toHaveTextContent('focused');

    await settle();
    expect(setUserPreference).toHaveBeenCalledWith('user-1', 'designer_focus_mode_quote_layout', true);
  });

  it('setFocused(false) from focused clears focus and saves false', async () => {
    getUserPreference.mockResolvedValue(true);
    render(<Probe designer="quote_layout" />);
    await waitFor(() => expect(screen.getByTestId('probe-state')).toHaveTextContent('focused'));

    await userEvent.click(document.getElementById('probe-off')!);
    expect(screen.getByTestId('probe-state')).toHaveTextContent('not-focused');

    await settle();
    expect(setUserPreference).toHaveBeenCalledWith('user-1', 'designer_focus_mode_quote_layout', false);
  });

  it('toggling updates the local cache under the same key', async () => {
    render(<Probe designer="document_layout" />);
    await settle();

    await userEvent.click(document.getElementById('probe-toggle')!);

    expect(window.localStorage.getItem('designer_focus_mode_document_layout')).toBe('true');
  });

  it('maps every designer to its own key', () => {
    const keys = DESIGNER_FOCUS_MODE_DESIGNERS.map(designerFocusModePreferenceKey);

    expect(keys).toEqual([
      'designer_focus_mode_service_request_form',
      'designer_focus_mode_invoice_layout',
      'designer_focus_mode_quote_layout',
      'designer_focus_mode_document_layout',
      'designer_focus_mode_workflow',
    ]);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('leaves another designer unfocused and saves nothing under its key', async () => {
    render(
      <>
        <Probe designer="invoice_layout" testId="invoice" />
        <Probe designer="quote_layout" testId="quote" />
      </>
    );
    await settle();

    await userEvent.click(document.getElementById('invoice-toggle')!);
    await settle();

    expect(screen.getByTestId('invoice-state')).toHaveTextContent('focused');
    expect(screen.getByTestId('quote-state')).toHaveTextContent('not-focused');
    expect(setUserPreference).toHaveBeenCalledWith('user-1', 'designer_focus_mode_invoice_layout', true);
    expect(setUserPreference).not.toHaveBeenCalledWith(
      'user-1',
      'designer_focus_mode_quote_layout',
      expect.anything()
    );
  });

  it('keeps a toggle made before the account value resolves, and saves it', async () => {
    const pending = deferred<boolean | null>();
    getUserPreference.mockReturnValue(pending.promise);

    render(<Probe designer="workflow" />);
    await act(async () => {
      await Promise.resolve();
    });

    await userEvent.click(document.getElementById('probe-toggle')!);
    expect(screen.getByTestId('probe-state')).toHaveTextContent('focused');

    await act(async () => {
      pending.resolve(false);
      await Promise.resolve();
    });
    await settle();

    expect(screen.getByTestId('probe-state')).toHaveTextContent('focused');
    expect(setUserPreference).toHaveBeenCalledWith('user-1', 'designer_focus_mode_workflow', true);
  });

  it('falls back to the cached value when the account value cannot be loaded', async () => {
    window.localStorage.setItem('designer_focus_mode_invoice_layout', 'true');
    getUserPreference.mockRejectedValue(new Error('offline'));

    render(<Probe designer="invoice_layout" />);
    await settle();

    expect(screen.getByTestId('probe-state')).toHaveTextContent('focused');

    await userEvent.click(document.getElementById('probe-toggle')!);
    expect(screen.getByTestId('probe-state')).toHaveTextContent('not-focused');
  });

  it('keeps the new value for the visit when saving fails', async () => {
    setUserPreference.mockRejectedValue(new Error('server down'));
    render(<Probe designer="invoice_layout" />);
    await settle();

    await userEvent.click(document.getElementById('probe-toggle')!);
    await settle();

    expect(setUserPreference).toHaveBeenCalled();
    expect(screen.getByTestId('probe-state')).toHaveTextContent('focused');
  });

  it('is reachable from the hooks index as well as its own module', () => {
    expect(hooksIndex.useDesignerFocusPreference).toBe(useDesignerFocusPreference);
    expect(hooksIndex.designerFocusModePreferenceKey).toBe(designerFocusModePreferenceKey);
  });
});
