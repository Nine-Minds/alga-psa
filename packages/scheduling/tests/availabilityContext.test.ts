// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AVAILABILITY_ACCESS_HINT_STORAGE_KEY,
  AVAILABILITY_CONTEXT_STORAGE_KEY,
  isReloadNavigation,
  readAvailabilityAccessHint,
  readAvailabilityContext,
  writeAvailabilityAccessHint,
  writeAvailabilityContext,
} from '../src/lib/availabilityContext';

describe('availability dialog context', () => {
  beforeEach(() => window.sessionStorage.clear());

  it('restores valid per-tab dialog, tab, team, and technician state', () => {
    writeAvailabilityContext({ isOpen: true, activeTab: 'user-hours', selectedTeamId: 'team-1', selectedUserId: 'user-1' });

    expect(readAvailabilityContext()).toEqual({
      isOpen: true,
      activeTab: 'user-hours',
      selectedTeamId: 'team-1',
      selectedUserId: 'user-1',
    });
    expect(window.sessionStorage.getItem(AVAILABILITY_CONTEXT_STORAGE_KEY)).toContain('user-1');
  });

  it('ignores malformed stored context instead of inventing IDs', () => {
    window.sessionStorage.setItem(AVAILABILITY_CONTEXT_STORAGE_KEY, '{broken');
    expect(readAvailabilityContext()).toBeNull();
  });
});

describe('availability access hint', () => {
  beforeEach(() => window.sessionStorage.clear());

  it('defaults to no access so a fresh tab never assumes permission', () => {
    expect(readAvailabilityAccessHint()).toBe(false);
  });

  it('remembers a granted answer so a repeat visit paints the button at once', () => {
    writeAvailabilityAccessHint(true);

    expect(readAvailabilityAccessHint()).toBe(true);
    expect(window.sessionStorage.getItem(AVAILABILITY_ACCESS_HINT_STORAGE_KEY)).toBe('true');
  });

  it('clears the hint once access is denied', () => {
    writeAvailabilityAccessHint(true);
    writeAvailabilityAccessHint(false);

    expect(readAvailabilityAccessHint()).toBe(false);
  });

  it('treats an unrecognised stored value as no access', () => {
    window.sessionStorage.setItem(AVAILABILITY_ACCESS_HINT_STORAGE_KEY, 'yes-please');
    expect(readAvailabilityAccessHint()).toBe(false);
  });
});

describe('reload detection', () => {
  afterEach(() => vi.restoreAllMocks());

  const stubNavigationType = (type: string) => {
    vi.spyOn(performance, 'getEntriesByType').mockImplementation((entryType: string) =>
      (entryType === 'navigation' ? [{ type } as PerformanceNavigationTiming] : []) as PerformanceEntry[],
    );
  };

  it('reports a refresh', () => {
    stubNavigationType('reload');
    expect(isReloadNavigation()).toBe(true);
  });

  it('does not treat an ordinary visit as a refresh', () => {
    stubNavigationType('navigate');
    expect(isReloadNavigation()).toBe(false);
  });

  it('says no when the browser reports no navigation entry', () => {
    vi.spyOn(performance, 'getEntriesByType').mockReturnValue([]);
    expect(isReloadNavigation()).toBe(false);
  });
});
