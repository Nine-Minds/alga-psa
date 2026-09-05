/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { armNavigationCommitWatchdog } from '../../../components/layout/navigationCommitWatchdog';

describe('armNavigationCommitWatchdog', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    window.history.replaceState({}, '', '/msp/dashboard');
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('re-pushes while the location has not left the starting path', () => {
    const push = vi.fn();
    armNavigationCommitWatchdog('/msp/schedule', push, [100, 200]);

    vi.advanceTimersByTime(100);
    expect(push).toHaveBeenCalledTimes(1);
    expect(push).toHaveBeenCalledWith('/msp/schedule');

    vi.advanceTimersByTime(100);
    expect(push).toHaveBeenCalledTimes(2);
  });

  it('does nothing once the navigation commits', () => {
    const push = vi.fn();
    armNavigationCommitWatchdog('/msp/schedule', push, [100, 200]);

    window.history.replaceState({}, '', '/msp/schedule');
    vi.advanceTimersByTime(500);
    expect(push).not.toHaveBeenCalled();
  });

  it('stops retrying after cancel', () => {
    const push = vi.fn();
    const cancel = armNavigationCommitWatchdog('/msp/schedule', push, [100, 200]);

    cancel();
    vi.advanceTimersByTime(500);
    expect(push).not.toHaveBeenCalled();
  });
});
