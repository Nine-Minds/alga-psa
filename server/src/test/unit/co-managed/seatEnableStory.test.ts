import { describe, expect, it } from 'vitest';
import { resolveSeatEnableStory, type SeatTrialStory } from '@/lib/co-managed/seatEnableStory';

const pool = (purchased: number) => ({ purchased, allocated: Math.min(purchased, 1), available: Math.max(purchased - 1, 0) });
const view = (purchased: number, blocker: string | null) => ({ capacity: pool(purchased), blocker });
const trials: SeatTrialStory[] = ['available', 'pending', 'active', 'ended'];
const blockers = [null, 'SPONSOR_NOT_ELIGIBLE', 'CAPACITY_UNAVAILABLE', 'ENTITLEMENT_LAPSED', 'CLIENT_INACTIVE'];

// The chooser's own expressions before the trial story existed.
const today = (enable: ReturnType<typeof view>, purchaseOpen: boolean) => {
  const blocker = enable.blocker === 'CAPACITY_UNAVAILABLE' && purchaseOpen ? null : enable.blocker;
  return { blocker, seatDisabled: blocker !== null };
};

describe('resolveSeatEnableStory', () => {
  describe('no trial: today\'s output exactly', () => {
    for (const purchased of [0, 5]) for (const purchaseOpen of [false, true]) for (const blocker of blockers) {
      it(`purchased=${purchased} purchaseOpen=${purchaseOpen} blocker=${blocker}`, () => {
        const enable = view(purchased, blocker);
        expect(resolveSeatEnableStory({ enable, trial: 'none', purchaseOpen, workspaceOffered: true })).toEqual({
          tone: 'blocked', notice: null, pool: 'count', seatHint: 'default', ...today(enable, purchaseOpen) });
      });
    }
  });

  describe('a trial on screen', () => {
    for (const trial of trials) for (const purchased of [0, 5]) for (const purchaseOpen of [false, true]) for (const blocker of blockers) {
      it(`${trial} purchased=${purchased} purchaseOpen=${purchaseOpen} blocker=${blocker}`, () => {
        const enable = view(purchased, blocker);
        const story = resolveSeatEnableStory({ enable, trial, purchaseOpen, workspaceOffered: true });
        expect(story.tone).toBe('trial');
        expect(story.blocker).toBeNull();
        expect(story.notice).toBe(trial);
        expect(story.pool).toBe(purchased > 0 ? 'count' : 'hidden');
        expect(story.seatDisabled).toBe(today(enable, purchaseOpen).seatDisabled);
        expect(story.seatHint).toBe(!story.seatDisabled ? 'default' : trial === 'active' ? 'trialCovers' : 'afterTrial');
      });
    }

    it('the sponsor-not-eligible screenshot state is neutral: no alert, no pool line, Seat disabled with a hint', () => {
      expect(resolveSeatEnableStory({ enable: view(0, 'SPONSOR_NOT_ELIGIBLE'), trial: 'available', purchaseOpen: false, workspaceOffered: true }))
        .toEqual({ tone: 'trial', blocker: null, notice: 'available', pool: 'hidden', seatDisabled: true, seatHint: 'afterTrial' });
    });

    it('keeps the capacity downgrade: an empty pool that can be bought into leaves Seat enabled', () => {
      const story = resolveSeatEnableStory({ enable: view(0, 'CAPACITY_UNAVAILABLE'), trial: 'pending', purchaseOpen: true, workspaceOffered: true });
      expect(story.seatDisabled).toBe(false);
      expect(story.seatHint).toBe('default');
    });
  });

  it('is total without a seat read', () => {
    for (const trial of [...trials, 'none' as const]) {
      expect(resolveSeatEnableStory({ enable: null, trial, purchaseOpen: false, workspaceOffered: false }))
        .toMatchObject({ blocker: null, pool: 'hidden', seatDisabled: false });
    }
  });
});
