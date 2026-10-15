/* @vitest-environment jsdom */
import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';

import { useUrlTaskOpenGuard, type UrlTaskOpenGuard } from '../useUrlTaskOpenGuard';

afterEach(cleanup);

function mountGuard(): { guard: UrlTaskOpenGuard; rerender: () => void } {
  const seen: UrlTaskOpenGuard[] = [];
  function Harness() {
    seen.push(useUrlTaskOpenGuard());
    return null;
  }
  const view = render(<Harness />);
  return {
    get guard() {
      return seen[seen.length - 1];
    },
    rerender: () => view.rerender(<Harness />),
  };
}

describe('useUrlTaskOpenGuard', () => {
  it('opens a task linked from a notification once', () => {
    const { guard } = mountGuard();
    expect(guard.arm('task-1')).toBe(true);
    expect(guard.canOpen()).toBe(true);
    guard.markOpened('task-1');
    expect(guard.canOpen()).toBe(false);
    // The effect re-runs for unrelated reasons (phases reload): still handled.
    expect(guard.arm('task-1')).toBe(false);
    expect(guard.canOpen()).toBe(false);
  });

  it('does not reopen a task the user opened by clicking, after its data refreshes', () => {
    const { guard } = mountGuard();
    // Click: the dialog opens and the task id is written to the URL.
    guard.markOpened('task-9');
    // The URL change reaches the open-from-URL effect...
    expect(guard.arm('task-9')).toBe(false);
    // ...and when a save later adds the task to the loaded list, it must stay closed.
    expect(guard.canOpen()).toBe(false);
  });

  it('opens the same task again from a new link once the dialog has closed', () => {
    const { guard } = mountGuard();
    guard.markOpened('task-1');
    // Closing clears the task id from the URL.
    expect(guard.arm(null)).toBe(false);
    expect(guard.arm('task-1')).toBe(true);
    expect(guard.canOpen()).toBe(true);
  });

  it('arms for a different task while one is open', () => {
    const { guard } = mountGuard();
    guard.markOpened('task-1');
    expect(guard.arm('task-2')).toBe(true);
    expect(guard.canOpen()).toBe(true);
  });

  it('keeps its state and identity across renders', () => {
    const mounted = mountGuard();
    const first = mounted.guard;
    first.markOpened('task-1');
    mounted.rerender();
    expect(mounted.guard).toBe(first);
    expect(mounted.guard.arm('task-1')).toBe(false);
  });
});
