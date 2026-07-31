import { describe, expect, it, vi } from 'vitest';
import {
  getStaleActionState,
  isStaleServerActionError,
  markStaleActionState,
  subscribeToStaleActionState,
} from './staleActionState';

describe('staleActionState', () => {
  it('recognizes a stale action by name when the Next.js instanceof check cannot', () => {
    const errorFromAnotherBundle = { name: 'UnrecognizedActionError' };

    expect(isStaleServerActionError(errorFromAnotherBundle)).toBe(true);
    expect(isStaleServerActionError(new Error('network unavailable'))).toBe(false);
  });

  it('sets the shared stale state once and keeps it sticky', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeToStaleActionState(listener);

    expect(getStaleActionState()).toBe(false);

    markStaleActionState();
    markStaleActionState();

    expect(getStaleActionState()).toBe(true);
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
  });
});
