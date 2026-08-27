// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import {
  AVAILABILITY_CONTEXT_STORAGE_KEY,
  readAvailabilityContext,
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
