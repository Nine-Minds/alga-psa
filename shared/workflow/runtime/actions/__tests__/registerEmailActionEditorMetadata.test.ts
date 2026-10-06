import { beforeAll, describe, expect, it } from 'vitest';

import { zodToWorkflowJsonSchema } from '../../jsonSchemaMetadata';
import { getActionRegistryV2 } from '../../registries/actionRegistry';
import { registerEmailActions } from '../businessOperations/email';

describe('email.send editor metadata', () => {
  beforeAll(() => {
    if (!getActionRegistryV2().get('email.send', 1)) {
      registerEmailActions();
    }
  });

  it('gives the HTML and plain-text bodies a multi-line editor and keeps their descriptions', () => {
    const action = getActionRegistryV2().get('email.send', 1);
    if (!action) throw new Error('Expected email.send to be registered');
    const properties = (zodToWorkflowJsonSchema(action.inputSchema) as {
      properties: Record<string, Record<string, unknown>>;
    }).properties;

    for (const key of ['html', 'text']) {
      expect(properties[key]['x-workflow-editor']).toMatchObject({ kind: 'text', inline: { mode: 'textarea' } });
      expect(properties[key].description).toMatch(/body/);
    }
    expect(properties.subject['x-workflow-editor']).toBeUndefined();
  });
});
