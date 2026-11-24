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
          tone: 'blocked', notice: null, pool: 'count', seatHint: 'default', seatLeadsTo: 'setup', heading: 'notEnabled', ...today(enable, purchaseOpen) });
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
        if (trial === 'available' && purchased === 0) return; // the trial leads Seat; covered below
        expect(story.seatDisabled).toBe(today(enable, purchaseOpen).seatDisabled);
        expect(story.seatHint).toBe(!story.seatDisabled ? 'default' : trial === 'active' ? 'trialCovers' : 'afterTrial');
        expect(story.seatLeadsTo).toBe('setup');
        expect(story.heading).toBe('notEnabled');
      });
    }

    it('the sponsor-not-eligible screenshot state: the trial is how Seat is enabled; no alert, no pool line, Seat leads to the trial', () => {
      expect(resolveSeatEnableStory({ enable: view(0, 'SPONSOR_NOT_ELIGIBLE'), trial: 'available', purchaseOpen: false, workspaceOffered: true }))
        .toEqual({ tone: 'trial', blocker: null, notice: 'available', pool: 'hidden', seatDisabled: false, seatHint: 'trial',
          seatLeadsTo: 'trial', heading: 'trialEnables' });
    });

    it('trial ended without a pool: the sponsor blocker still disables Seat with the after-trial hint', () => {
      expect(resolveSeatEnableStory({ enable: view(0, 'SPONSOR_NOT_ELIGIBLE'), trial: 'ended', purchaseOpen: false, workspaceOffered: true }))
        .toMatchObject({ seatDisabled: true, seatHint: 'afterTrial', seatLeadsTo: 'setup', heading: 'notEnabled' });
    });

    it('keeps the capacity downgrade: an empty pool that can be bought into leaves Seat enabled', () => {
      const story = resolveSeatEnableStory({ enable: view(0, 'CAPACITY_UNAVAILABLE'), trial: 'pending', purchaseOpen: true, workspaceOffered: true });
      expect(story.seatDisabled).toBe(false);
      expect(story.seatHint).toBe('default');
    });
  });

  // The status heading: only a startable trial with no paid pool says "starting the trial enables it".
  describe('heading', () => {
    const heading = (trial: SeatTrialStory, purchased: number, blocker: string | null = null) =>
      resolveSeatEnableStory({ enable: view(purchased, blocker), trial, purchaseOpen: false, workspaceOffered: true }).heading;
    it('available with no pool: the trial enables co-managed IT', () => {
      expect(heading('available', 0, 'SPONSOR_NOT_ELIGIBLE')).toBe('trialEnables');
      expect(heading('available', 0)).toBe('trialEnables');
    });
    it('pending, active, ended: not enabled', () => {
      for (const trial of ['pending', 'active', 'ended'] as const) expect(heading(trial, 0, 'SPONSOR_NOT_ELIGIBLE')).toBe('notEnabled');
    });
    it('a paid pool that is present: not enabled, Seat keeps its pool route', () => {
      expect(heading('available', 5)).toBe('notEnabled');
      expect(heading('none', 5)).toBe('notEnabled');
      expect(resolveSeatEnableStory({ enable: view(5, null), trial: 'available', purchaseOpen: false, workspaceOffered: true }).seatLeadsTo).toBe('setup');
    });
    it('no offer: not enabled', () => {
      expect(heading('none', 0, 'SPONSOR_NOT_ELIGIBLE')).toBe('notEnabled');
      expect(resolveSeatEnableStory({ enable: null, trial: 'none', purchaseOpen: false, workspaceOffered: false }).heading).toBe('notEnabled');
    });
  });

  it('is total without a seat read', () => {
    for (const trial of [...trials, 'none' as const]) {
      expect(resolveSeatEnableStory({ enable: null, trial, purchaseOpen: false, workspaceOffered: false }))
        .toMatchObject({ blocker: null, pool: 'hidden', seatDisabled: false });
    }
  });
});
