import { afterEach, describe, expect, it } from 'vitest';

import {
  clearActionsForTest,
  listActions,
  registerAction,
  type InboundActionDefinition,
} from '@/lib/inboundWebhooks/actions/registry';

function action(name: string, entityType: string): InboundActionDefinition {
  return {
    name,
    entityType,
    displayName: name,
    description: `${name} description`,
    targetFields: [
      {
        name: 'external_id',
        type: 'string',
        required: true,
        description: 'External identifier',
      },
    ],
    handle: async () => ({ success: true, entityType, entityId: `${name}-id` }),
  };
}

describe('inbound action registry', () => {
  afterEach(() => {
    clearActionsForTest();
  });

  it('T090: registers actions and lists them grouped by entity type order', () => {
    registerAction(action('updateTicketByExternalId', 'ticket'));
    registerAction(action('upsertClientByExternalId', 'client'));
    registerAction(action('createTicket', 'ticket'));

    expect(listActions().map(({ entityType, name }) => `${entityType}:${name}`)).toEqual([
      'client:upsertClientByExternalId',
      'ticket:createTicket',
      'ticket:updateTicketByExternalId',
    ]);
  });
});
