import { describe, expect, it } from 'vitest';
import knex from 'knex';
import {
  applyVisibilityToQuery,
  filterVisibleCannedResponses,
  isCannedResponseVisible,
  libraryVisibility,
  pickerVisibility,
  type CannedResponseVisibilityRow,
} from './visibility';

const ME = 'user-me';
const OTHER = 'user-other';
const TEAM_A = 'team-a';
const TEAM_B = 'team-b';
const BOARD_1 = 'board-1';
const BOARD_2 = 'board-2';

const row = (partial: Partial<CannedResponseVisibilityRow>): CannedResponseVisibilityRow => ({
  scope: 'personal', owner_user_id: null, team_id: null, board_id: null, ...partial,
});

const mine = row({ scope: 'personal', owner_user_id: ME });
const theirs = row({ scope: 'personal', owner_user_id: OTHER });
const teamA = row({ scope: 'team', team_id: TEAM_A });
const teamB = row({ scope: 'team', team_id: TEAM_B });
const board1 = row({ scope: 'board', board_id: BOARD_1 });
const board2 = row({ scope: 'board', board_id: BOARD_2 });
const portal = row({ scope: 'client_portal' });
const all = [mine, theirs, teamA, teamB, board1, board2, portal];

describe('picker visibility (MSP surface)', () => {
  const viewer = pickerVisibility({ userId: ME, teamIds: [TEAM_A], boardId: BOARD_1, surface: 'msp' });

  it('shows own personal, member teams and the ticket board; hides everything else', () => {
    expect(filterVisibleCannedResponses(all, viewer)).toEqual([mine, teamA, board1]);
  });

  it('never shows another user\'s personal response', () => {
    expect(isCannedResponseVisible(theirs, viewer)).toBe(false);
  });

  it('shows no board responses when the ticket has no board', () => {
    const noBoard = pickerVisibility({ userId: ME, teamIds: [TEAM_A], boardId: null, surface: 'msp' });
    expect(filterVisibleCannedResponses(all, noBoard)).toEqual([mine, teamA]);
  });

  it('shows no team responses to a user in no team', () => {
    const noTeams = pickerVisibility({ userId: ME, teamIds: [], boardId: BOARD_2, surface: 'msp' });
    expect(filterVisibleCannedResponses(all, noTeams)).toEqual([mine, board2]);
  });

  it('rejects malformed personal/team/board rows rather than leaking them', () => {
    expect(isCannedResponseVisible(row({ scope: 'personal' }), viewer)).toBe(false);
    expect(isCannedResponseVisible(row({ scope: 'team' }), viewer)).toBe(false);
    expect(isCannedResponseVisible(row({ scope: 'board' }), viewer)).toBe(false);
  });
});

describe('client_portal scope', () => {
  it('is hidden on the MSP surface and shown on the client-portal surface', () => {
    const msp = pickerVisibility({ userId: ME, teamIds: [], boardId: null, surface: 'msp' });
    const portalSurface = pickerVisibility({ userId: ME, teamIds: [], boardId: null, surface: 'client_portal' });
    expect(isCannedResponseVisible(portal, msp)).toBe(false);
    expect(isCannedResponseVisible(portal, portalSurface)).toBe(true);
  });
});

describe('library visibility (management)', () => {
  it('shows every shared response plus only the viewer\'s own personal ones', () => {
    expect(filterVisibleCannedResponses(all, libraryVisibility(ME))).toEqual([mine, teamA, teamB, board1, board2, portal]);
  });
});

describe('applyVisibilityToQuery produces SQL matching the in-memory rule', () => {
  const db = knex({ client: 'pg' });
  const sql = (viewer: Parameters<typeof applyVisibilityToQuery>[1]) =>
    applyVisibilityToQuery(db('canned_responses'), viewer).toSQL().toNative();

  it('constrains by owner, member teams and ticket board, and omits client_portal on MSP', () => {
    const { sql: text, bindings } = sql(pickerVisibility({ userId: ME, teamIds: [TEAM_A], boardId: BOARD_1, surface: 'msp' }));
    expect(text).toContain('"scope" = $1 and "owner_user_id" = $2');
    expect(text).toContain('"team_id" in');
    expect(text).toContain('"board_id" in');
    expect(bindings).toEqual(['personal', ME, 'team', TEAM_A, 'board', BOARD_1]);
  });

  it('adds only the personal clause for a user with no teams and no board', () => {
    const { bindings } = sql(pickerVisibility({ userId: ME, teamIds: [], boardId: null, surface: 'msp' }));
    expect(bindings).toEqual(['personal', ME]);
  });

  it('includes client_portal on the portal surface and every shared scope for the library', () => {
    expect(sql(pickerVisibility({ userId: ME, teamIds: [], boardId: null, surface: 'client_portal' })).bindings)
      .toEqual(['personal', ME, 'client_portal']);
    expect(sql(libraryVisibility(ME)).bindings).toEqual(['personal', ME, 'team', 'board', 'client_portal']);
  });
});
