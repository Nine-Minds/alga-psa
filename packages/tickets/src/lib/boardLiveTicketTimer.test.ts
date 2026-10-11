import { describe, expect, it } from 'vitest';
import {
  isBoardLiveTicketTimerEnabled,
  normalizeBoardStopwatchSetting,
  resolveBoardStopwatchEnabled,
} from './boardLiveTicketTimer';

describe('boardLiveTicketTimer', () => {
  it('resolves missing or null to enabled and respects explicit values', () => {
    expect(resolveBoardStopwatchEnabled(undefined)).toBe(true);
    expect(resolveBoardStopwatchEnabled(null)).toBe(true);
    expect(resolveBoardStopwatchEnabled(true)).toBe(true);
    expect(resolveBoardStopwatchEnabled(false)).toBe(false);
  });

  it('normalizes null/undefined to true without touching explicit values', () => {
    expect(normalizeBoardStopwatchSetting({ enable_live_ticket_timer: null }).enable_live_ticket_timer).toBe(true);
    expect(normalizeBoardStopwatchSetting<{ enable_live_ticket_timer?: boolean }>({}).enable_live_ticket_timer).toBe(true);
    const off = { enable_live_ticket_timer: false, board_id: 'b' };
    expect(normalizeBoardStopwatchSetting(off)).toBe(off);
    const on = { enable_live_ticket_timer: true };
    expect(normalizeBoardStopwatchSetting(on)).toBe(on);
  });

  it('does not mutate the input when normalizing', () => {
    const board = { enable_live_ticket_timer: null as boolean | null, name: 'x' };
    const result = normalizeBoardStopwatchSetting(board);
    expect(board.enable_live_ticket_timer).toBeNull();
    expect(result).toEqual({ enable_live_ticket_timer: true, name: 'x' });
  });

  it('isBoardLiveTicketTimerEnabled handles missing boards', () => {
    expect(isBoardLiveTicketTimerEnabled(null)).toBe(true);
    expect(isBoardLiveTicketTimerEnabled(undefined)).toBe(true);
    expect(isBoardLiveTicketTimerEnabled({ enable_live_ticket_timer: false })).toBe(false);
  });
});
