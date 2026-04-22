import { describe, expect, it } from 'vitest';

import { evaluateRelationshipTemplate } from 'server/src/lib/authorization/kernel';

const baseInput = {
  subject: {
    tenant: 'tenant-a',
    userId: 'user-a',
    userType: 'internal' as const,
    teamIds: ['team-a'],
    clientId: 'client-a',
    managedUserIds: ['user-b'],
    portfolioClientIds: ['client-a', 'client-b'],
  },
  resource: {
    type: 'ticket',
    action: 'read',
  },
  selectedBoardIds: ['board-a'],
};

describe('relationship templates', () => {
  it('supports own, assigned, and managed', () => {
    const record = {
      ownerUserId: 'user-a',
      assignedUserIds: ['user-b'],
    };

    expect(evaluateRelationshipTemplate('own', { ...baseInput, record })).toBe(true);
    expect(evaluateRelationshipTemplate('assigned', { ...baseInput, record })).toBe(false);
    expect(evaluateRelationshipTemplate('managed', { ...baseInput, record })).toBe(true);
    expect(evaluateRelationshipTemplate('own_or_assigned', { ...baseInput, record })).toBe(true);
    expect(evaluateRelationshipTemplate('own_or_managed', { ...baseInput, record })).toBe(true);
  });

  it('supports same-client and client-portfolio', () => {
    const sameClient = { clientId: 'client-a' };
    const portfolioClient = { clientId: 'client-b' };
    const outsidePortfolio = { clientId: 'client-z' };

    expect(evaluateRelationshipTemplate('same_client', { ...baseInput, record: sameClient })).toBe(true);
    expect(evaluateRelationshipTemplate('client_portfolio', { ...baseInput, record: portfolioClient })).toBe(true);
    expect(evaluateRelationshipTemplate('selected_clients', { ...baseInput, record: sameClient })).toBe(false);
    expect(
      evaluateRelationshipTemplate('selected_clients', {
        ...baseInput,
        selectedClientIds: ['client-a'],
        record: sameClient,
      })
    ).toBe(true);
    expect(evaluateRelationshipTemplate('client_portfolio', { ...baseInput, record: outsidePortfolio })).toBe(false);
  });

  it('supports same-team and selected-boards', () => {
    const record = {
      teamIds: ['team-a', 'team-c'],
      boardId: 'board-a',
    };

    expect(evaluateRelationshipTemplate('same_team', { ...baseInput, record })).toBe(true);
    expect(evaluateRelationshipTemplate('selected_boards', { ...baseInput, record })).toBe(true);
  });
});
