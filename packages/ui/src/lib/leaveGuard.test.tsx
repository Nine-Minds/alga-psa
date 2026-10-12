/** @vitest-environment jsdom */

import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { registerLeaveGuard } from './leaveGuard';
import { UnsavedChangesProvider, useRegisterUnsavedChanges } from '../context/UnsavedChangesContext';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function chord(target: EventTarget, init: KeyboardEventInit) {
  const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(event);
  return event;
}

function Dirty({ dirty }: { dirty: boolean }) {
  useRegisterUnsavedChanges('draft', dirty);
  return (
    <>
      <button type="button">outside</button>
      <div contentEditable suppressContentEditableWarning tabIndex={0} aria-label="editor" />
    </>
  );
}

describe('leave guard shared by DismissGuard and UnsavedChangesProvider', () => {
  it('installs a single beforeunload and keydown listener however many sources register', () => {
    const add = vi.spyOn(window, 'addEventListener');
    const remove = vi.spyOn(window, 'removeEventListener');

    const offA = registerLeaveGuard(() => true);
    const offB = registerLeaveGuard(() => false);

    const installed = add.mock.calls.map(([type]) => type);
    expect(installed.filter((type) => type === 'beforeunload')).toHaveLength(1);
    expect(installed.filter((type) => type === 'keydown')).toHaveLength(1);

    offA();
    expect(remove).not.toHaveBeenCalled();
    offB();
    expect(remove.mock.calls.map(([type]) => type).sort()).toEqual(['beforeunload', 'keydown']);
  });

  it('works without any UnsavedChangesProvider (in-container case)', () => {
    const off = registerLeaveGuard(() => true);
    const button = document.body.appendChild(document.createElement('button'));

    const beforeUnload = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(beforeUnload);
    expect(beforeUnload.defaultPrevented).toBe(true);
    expect(chord(button, { key: 'ArrowLeft', metaKey: true }).defaultPrevented).toBe(true);

    off();
    button.remove();
  });

  it('a page-level UnsavedChangesProvider with a dirty component blocks history chords outside an editable only', () => {
    render(
      <UnsavedChangesProvider>
        <Dirty dirty />
      </UnsavedChangesProvider>,
    );

    const outside = screen.getByRole('button', { name: 'outside' });
    const editor = screen.getByLabelText('editor');

    for (const init of [
      { key: 'ArrowLeft', metaKey: true },
      { key: 'ArrowRight', ctrlKey: true },
      { key: 'ArrowLeft', altKey: true },
      { key: '[', metaKey: true },
      { key: ']', metaKey: true },
    ]) {
      expect(chord(outside, init).defaultPrevented).toBe(true);
      expect(chord(editor, init).defaultPrevented).toBe(false);
    }

    // Plain arrows and other modified keys are never touched.
    expect(chord(outside, { key: 'ArrowLeft' }).defaultPrevented).toBe(false);
    expect(chord(outside, { key: 'a', metaKey: true }).defaultPrevented).toBe(false);

    const beforeUnload = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(beforeUnload);
    expect(beforeUnload.defaultPrevented).toBe(true);
  });

  it('a clean provider blocks nothing', () => {
    render(
      <UnsavedChangesProvider>
        <Dirty dirty={false} />
      </UnsavedChangesProvider>,
    );

    const outside = screen.getByRole('button', { name: 'outside' });
    expect(chord(outside, { key: 'ArrowLeft', metaKey: true }).defaultPrevented).toBe(false);
    const beforeUnload = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(beforeUnload);
    expect(beforeUnload.defaultPrevented).toBe(false);
  });
});
