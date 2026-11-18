import { describe, expect, it } from 'vitest';
import {
  BUNDLE_CHILD_LOCKED_FIELDS,
  effectiveBundleMode,
  isChildWorkflowLocked,
} from '../bundleWorkflowLock';

describe('effectiveBundleMode', () => {
  it('treats a missing settings row as link_only', () => {
    expect(effectiveBundleMode(null)).toBe('link_only');
    expect(effectiveBundleMode(undefined)).toBe('link_only');
  });

  it('treats a null or unknown mode as link_only', () => {
    expect(effectiveBundleMode({ mode: null })).toBe('link_only');
    expect(effectiveBundleMode({})).toBe('link_only');
    expect(effectiveBundleMode({ mode: 'something_else' as any })).toBe('link_only');
  });

  it('returns the stored mode otherwise', () => {
    expect(effectiveBundleMode({ mode: 'link_only' })).toBe('link_only');
    expect(effectiveBundleMode({ mode: 'sync_updates' })).toBe('sync_updates');
  });
});

describe('isChildWorkflowLocked', () => {
  it.each([
    [true, { mode: 'sync_updates' }, true],
    [true, { mode: 'link_only' }, false],
    [true, { mode: null }, false],
    [true, null, false],
    [false, { mode: 'sync_updates' }, false],
    [false, { mode: 'link_only' }, false],
    [false, null, false],
  ] as const)('isBundledChild=%s settings=%j -> %s', (isBundledChild, masterSettings, expected) => {
    expect(isChildWorkflowLocked({ isBundledChild, masterSettings: masterSettings as any })).toBe(expected);
  });
});

describe('BUNDLE_CHILD_LOCKED_FIELDS', () => {
  it('covers the propagated workflow fields', () => {
    expect([...BUNDLE_CHILD_LOCKED_FIELDS]).toEqual(['status_id', 'assigned_to', 'priority_id']);
  });
});
