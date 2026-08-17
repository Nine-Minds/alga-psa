import { describe, expect, it } from 'vitest';
import { tacticalAgentChangedSince } from './deviceSync';

/**
 * Tactical RMM's incremental window.
 *
 * /beta/v1/agent/ takes no server-side delta — only client_id — so
 * "incremental" is the same page walk filtered on last_seen. Getting this wrong
 * is silent in both directions: too strict and devices quietly stop updating,
 * too loose and the sync costs the same as a full one.
 */

const SINCE = new Date('2026-08-13T09:00:00.000Z');

describe('tacticalAgentChangedSince', () => {
  it('includes an agent seen after the cursor', () => {
    expect(tacticalAgentChangedSince({ last_seen: '2026-08-13T10:00:00.000Z' }, SINCE)).toBe(true);
  });

  it('excludes an agent last seen before the cursor', () => {
    expect(tacticalAgentChangedSince({ last_seen: '2026-08-01T10:00:00.000Z' }, SINCE)).toBe(false);
  });

  it('treats an agent seen exactly at the cursor as changed', () => {
    // Inclusive on purpose: an exclusive bound drops an agent that changed in
    // the same instant the previous run recorded as its cursor.
    expect(tacticalAgentChangedSince({ last_seen: '2026-08-13T09:00:00.000Z' }, SINCE)).toBe(true);
  });

  it('always considers an agent with no last_seen', () => {
    // Absent data must not exclude a device from every incremental run forever.
    expect(tacticalAgentChangedSince({ last_seen: null }, SINCE)).toBe(true);
    expect(tacticalAgentChangedSince({}, SINCE)).toBe(true);
  });

  it('always considers an agent whose last_seen is unparseable', () => {
    expect(tacticalAgentChangedSince({ last_seen: 'not a date' }, SINCE)).toBe(true);
  });

  it('accepts the camelCase spelling the API sometimes returns', () => {
    expect(tacticalAgentChangedSince({ lastSeen: '2026-08-01T00:00:00.000Z' }, SINCE)).toBe(false);
  });

  it('includes every agent when no cursor is given (full sync unchanged)', () => {
    expect(tacticalAgentChangedSince({ last_seen: '2020-01-01T00:00:00.000Z' }, undefined)).toBe(true);
  });
});
