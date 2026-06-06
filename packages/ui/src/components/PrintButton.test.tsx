/** @vitest-environment jsdom */

import React from 'react';
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PrintButton, usePrintAction } from './PrintButton';

// Isolate from i18n init: return the provided defaultValue (or the key), with
// {{var}} interpolation like react-i18next so count-aware labels resolve.
vi.mock('../lib/i18n/client', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      const template = (opts?.defaultValue as string | undefined) ?? key;
      return template.replace(/\{\{(\w+)\}\}/g, (_match, name: string) =>
        opts && name in opts ? String(opts[name]) : `{{${name}}}`,
      );
    },
  }),
}));

// Render a plain <button> so we exercise PrintButton's own logic (label,
// disabled-while-preparing, click wiring) without the ui-reflection machinery.
vi.mock('./Button', () => ({
  Button: ({ children, onClick, disabled, label }: any) => (
    <button type="button" onClick={onClick} disabled={disabled} aria-label={label}>
      {children}
    </button>
  ),
}));

let printSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  printSpy = vi.fn();
  // jsdom does not implement window.print.
  Object.defineProperty(window, 'print', { value: printSpy, writable: true, configurable: true });
  // Make requestAnimationFrame deterministic and synchronous-ish (microtask).
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    cb(0);
    return 0;
  });
  document.documentElement.classList.remove('app-print-mode');
});

afterEach(() => {
  cleanup();
  document.documentElement.classList.remove('app-print-mode');
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('usePrintAction', () => {
  it('enters print mode (adds app-print-mode to <html>) and calls window.print()', async () => {
    const { result } = renderHook(() => usePrintAction());

    await act(async () => {
      await result.current.triggerPrint();
    });

    expect(document.documentElement.classList.contains('app-print-mode')).toBe(true);
    expect(printSpy).toHaveBeenCalledTimes(1);
  });

  it('runs onBeforePrint BEFORE entering print mode', async () => {
    const sawClassDuringBeforePrint: boolean[] = [];
    const onBeforePrint = vi.fn(() => {
      sawClassDuringBeforePrint.push(
        document.documentElement.classList.contains('app-print-mode'),
      );
    });

    const { result } = renderHook(() => usePrintAction({ onBeforePrint }));

    await act(async () => {
      await result.current.triggerPrint();
    });

    expect(onBeforePrint).toHaveBeenCalledTimes(1);
    // The print-mode class must not be applied until after onBeforePrint resolves.
    expect(sawClassDuringBeforePrint).toEqual([false]);
  });

  it('exits print mode and runs onAfterPrint when the browser finishes printing', async () => {
    const onAfterPrint = vi.fn();
    const { result } = renderHook(() => usePrintAction({ onAfterPrint }));

    await act(async () => {
      await result.current.triggerPrint();
    });
    expect(document.documentElement.classList.contains('app-print-mode')).toBe(true);

    // Browser signals print finished -> cleanup must remove the class so the
    // app is not left with its on-screen content hidden.
    act(() => {
      window.dispatchEvent(new Event('afterprint'));
    });

    expect(document.documentElement.classList.contains('app-print-mode')).toBe(false);
    expect(onAfterPrint).toHaveBeenCalledTimes(1);
  });

  it('ignores re-entrant triggers while a print is already being prepared', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const onBeforePrint = vi.fn(() => gate);

    const { result } = renderHook(() => usePrintAction({ onBeforePrint }));

    let firstCall: Promise<void> | undefined;
    act(() => {
      firstCall = result.current.triggerPrint(); // suspends awaiting `gate`
    });

    // Second trigger while the first is mid-flight must be a no-op.
    await act(async () => {
      await result.current.triggerPrint();
    });
    expect(onBeforePrint).toHaveBeenCalledTimes(1);
    expect(printSpy).not.toHaveBeenCalled();

    await act(async () => {
      release();
      await firstCall;
    });
    expect(printSpy).toHaveBeenCalledTimes(1);
  });

  it('removes app-print-mode on unmount (no lingering print state)', async () => {
    const { result, unmount } = renderHook(() => usePrintAction());

    await act(async () => {
      await result.current.triggerPrint();
    });
    expect(document.documentElement.classList.contains('app-print-mode')).toBe(true);

    act(() => {
      unmount();
    });
    expect(document.documentElement.classList.contains('app-print-mode')).toBe(false);
  });

  it('marks only the print-region ancestor path so sibling app chrome is removed from print layout', async () => {
    const wrapper = document.createElement('div');
    wrapper.innerHTML = `
      <div id="layout">
        <aside id="sidebar">Sidebar</aside>
        <main id="main">
          <section id="screen-card">Screen content</section>
          <section id="print-root" class="app-print-root">Printable content</section>
        </main>
      </div>
    `;
    document.body.appendChild(wrapper);

    const { result } = renderHook(() => usePrintAction());

    await act(async () => {
      await result.current.triggerPrint();
    });

    expect(document.getElementById('layout')?.hasAttribute('data-app-print-preserve')).toBe(true);
    expect(document.getElementById('main')?.hasAttribute('data-app-print-preserve')).toBe(true);
    expect(document.getElementById('print-root')?.hasAttribute('data-app-print-preserve')).toBe(true);
    expect(document.getElementById('sidebar')?.hasAttribute('data-app-print-hidden')).toBe(true);
    expect(document.getElementById('screen-card')?.hasAttribute('data-app-print-hidden')).toBe(true);

    act(() => {
      window.dispatchEvent(new Event('afterprint'));
    });

    expect(document.querySelector('[data-app-print-preserve], [data-app-print-hidden]')).toBeNull();
    wrapper.remove();
  });
});

describe('PrintButton', () => {
  it('renders the default Print label and triggers a print on click', async () => {
    render(<PrintButton />);

    const button = screen.getByRole('button', { name: 'Print' }) as HTMLButtonElement;
    expect(button.disabled).toBe(false);

    await act(async () => {
      fireEvent.click(button);
    });

    await waitFor(() => expect(printSpy).toHaveBeenCalledTimes(1));
    expect(document.documentElement.classList.contains('app-print-mode')).toBe(true);
  });

  it('disables the button while preparing and re-enables it after printing', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    render(<PrintButton onBeforePrint={() => gate} />);
    const button = screen.getByRole('button', { name: 'Print' }) as HTMLButtonElement;

    fireEvent.click(button);
    // While onBeforePrint is pending, the button must be disabled.
    expect(button.disabled).toBe(true);

    await act(async () => {
      release();
    });
    await waitFor(() => expect(printSpy).toHaveBeenCalledTimes(1));

    act(() => {
      window.dispatchEvent(new Event('afterprint'));
    });
    await waitFor(() => expect(button.disabled).toBe(false));
  });

  it('shows a count-aware label when items are selected', () => {
    render(<PrintButton selectedCount={3} />);
    expect(screen.getByRole('button', { name: 'Print selected (3)' })).toBeTruthy();
  });
});
