import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  clearActionsForTest,
  listActions,
  registerAction,
  type InboundActionDefinition,
} from '@alga-psa/shared/inboundWebhooks/actions/registry';

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

  it('T091: rejects duplicate action names on register', () => {
    registerAction(action('createTicket', 'ticket'));

    expect(() => registerAction(action('createTicket', 'ticket'))).toThrow(
      'Inbound action "createTicket" is already registered',
    );
  });

  it('T092: bootstrap imports every v1 package action contribution before discovery', () => {
    const bootstrapSource = readFileSync(
      resolve(process.cwd(), 'src/lib/inboundWebhooks/actions/bootstrap.ts'),
      'utf8',
    );
    const serverActionsSource = readFileSync(
      resolve(process.cwd(), 'src/lib/actions/inboundWebhookActions.ts'),
      'utf8',
    );
    const initializeAppSource = readFileSync(resolve(process.cwd(), 'src/lib/initializeApp.ts'), 'utf8');

    for (const contribution of [
      '@alga-psa/tickets/actions/inboundActions',
      '@alga-psa/clients/actions/inboundActions',
      '@alga-psa/assets/actions/inboundActions',
      '@alga-psa/billing/actions/inboundActions',
      '@alga-psa/scheduling/actions/inboundActions',
      '@alga-psa/projects/actions/inboundActions',
      '@alga-psa/tags/actions/inboundActions',
    ]) {
      expect(bootstrapSource).toContain(`import('${contribution}')`);
    }

    expect(serverActionsSource).toContain('await bootstrapInboundWebhookActions();');
    expect(serverActionsSource).toContain('return listActions().map');
    expect(initializeAppSource).toContain('await bootstrapInboundWebhookActions();');
  });
});
