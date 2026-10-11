/** @vitest-environment jsdom */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup } from '@testing-library/react';
import { registerLeaveGuard } from './leaveGuard';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function chord(target: EventTarget, init: KeyboardEventInit) {
  const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(event);
  return event;
}

describe('leave guard shared by DismissGuard', () => {
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
});
