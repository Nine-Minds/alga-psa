import { beforeAll, describe, expect, it } from 'vitest';
import { getActionRegistryV2 } from '../../registries/actionRegistry';
import { registerTransformActionsV2 } from '../registerTransformActions';

describe('registerTransformActionsV2', () => {
  beforeAll(() => {
    if (!getActionRegistryV2().get('transform.truncate_text', 1)) {
      registerTransformActionsV2();
    }
  });

  it('T226/T227/T228: registers text transform actions with explicit input and output schemas', () => {
    const registry = getActionRegistryV2();
    const actionIds = [
      'transform.compose_text',
      'transform.truncate_text',
      'transform.concat_text',
      'transform.replace_text',
      'transform.split_text',
      'transform.join_text',
      'transform.lowercase_text',
      'transform.uppercase_text',
      'transform.trim_text',
      'transform.coalesce_value',
      'transform.build_object',
      'transform.pick_fields',
      'transform.rename_fields',
      'transform.append_array',
      'transform.build_array',
    ];

    for (const actionId of actionIds) {
      const action = registry.get(actionId, 1);
      expect(action, actionId).toBeDefined();
      expect(action?.ui?.category).toBe('Transform');
      expect(action?.sideEffectful).toBe(false);
      expect(action?.inputSchema).toBeDefined();
      expect(action?.outputSchema).toBeDefined();
    }
  });

  it('T251/T252/T253/T254/T255/T256/T257/T258: exposes typed output fields for text transforms', () => {
    const registry = getActionRegistryV2();

    expect(registry.get('transform.truncate_text', 1)?.outputSchema.safeParse({ text: 'abc' }).success).toBe(true);
    expect(registry.get('transform.compose_text', 1)?.outputSchema.safeParse({ prompt: 'abc' }).success).toBe(true);
    expect(registry.get('transform.concat_text', 1)?.outputSchema.safeParse({ text: 'abc' }).success).toBe(true);
    expect(registry.get('transform.replace_text', 1)?.outputSchema.safeParse({ text: 'abc' }).success).toBe(true);
    expect(registry.get('transform.split_text', 1)?.outputSchema.safeParse({ items: ['a', 'b'] }).success).toBe(true);
    expect(registry.get('transform.join_text', 1)?.outputSchema.safeParse({ text: 'abc' }).success).toBe(true);
    expect(registry.get('transform.lowercase_text', 1)?.outputSchema.safeParse({ text: 'abc' }).success).toBe(true);
    expect(registry.get('transform.uppercase_text', 1)?.outputSchema.safeParse({ text: 'ABC' }).success).toBe(true);
    expect(registry.get('transform.trim_text', 1)?.outputSchema.safeParse({ text: 'abc' }).success).toBe(true);
  });

  it('T268/T272/T273: exposes schema-driven outputs for coalesce and array transforms', () => {
    const registry = getActionRegistryV2();

    expect(registry.get('transform.coalesce_value', 1)?.outputSchema.safeParse({ value: 'ticket-123', matchedIndex: 2 }).success).toBe(true);
    expect(registry.get('transform.append_array', 1)?.outputSchema.safeParse({ items: ['ticket', 'contact'] }).success).toBe(true);
    expect(registry.get('transform.build_array', 1)?.outputSchema.safeParse({ items: ['ticket', 42] }).success).toBe(true);
  });

  it('T241/T244/T245/T246/T247/T248/T249/T250: applies representative text transforms through runtime handlers', async () => {
    const registry = getActionRegistryV2();

    const composeText = registry.get('transform.compose_text', 1);
    const truncate = registry.get('transform.truncate_text', 1);
    const concat = registry.get('transform.concat_text', 1);
    const replace = registry.get('transform.replace_text', 1);
    const split = registry.get('transform.split_text', 1);
    const join = registry.get('transform.join_text', 1);
    const lowercase = registry.get('transform.lowercase_text', 1);
    const uppercase = registry.get('transform.uppercase_text', 1);
    const trim = registry.get('transform.trim_text', 1);

    const composed = await composeText?.handler(
      composeText.inputSchema.parse({}),
      {
        runId: 'run-1',
        stepPath: 'root.steps[0]',
        stepConfig: {
          actionId: 'transform.compose_text',
          version: 1,
          outputs: [
            {
              id: 'out-1',
              label: 'Prompt',
              stableKey: 'prompt',
              document: {
                version: 1,
                blocks: [
                  {
                    type: 'paragraph',
                    children: [
                      { type: 'text', text: 'Ticket ' },
                      { type: 'reference', path: 'payload.ticket.id', label: 'Ticket ID' },
                    ],
                  },
                ],
              },
            },
          ],
        },
        tenantId: null,
        idempotencyKey: 'key',
        attempt: 1,
        nowIso: () => '2026-03-14T00:00:00.000Z',
        env: {},
        expressionContext: {
          payload: { ticket: { id: 'T-100' } },
          vars: {},
          meta: {},
          error: undefined,
        },
      } as never
    );
    const truncated = await truncate?.handler(
      truncate.inputSchema.parse({ text: 'workflow designer', maxLength: 12, strategy: 'middle', ellipsis: '...' }),
      {} as never
    );
    const concatenated = await concat?.handler(
      concat.inputSchema.parse({ values: ['workflow', 'designer'], separator: ' ' }),
      {} as never
    );
    const replaced = await replace?.handler(
      replace.inputSchema.parse({ text: 'workflow workflow', search: 'workflow', replacement: 'designer', replaceAll: false }),
      {} as never
    );
    const splitText = await split?.handler(
      split.inputSchema.parse({ text: 'a,,b', delimiter: ',', removeEmpty: true }),
      {} as never
    );
    const joinedText = await join?.handler(
      join.inputSchema.parse({ items: ['workflow', 'designer'], delimiter: '::' }),
      {} as never
    );
    const lowercased = await lowercase?.handler(
      lowercase.inputSchema.parse({ text: 'AlGa' }),
      {} as never
    );
    const uppercased = await uppercase?.handler(
      uppercase.inputSchema.parse({ text: 'alga' }),
      {} as never
    );
    const trimmed = await trim?.handler(
      trim.inputSchema.parse({ text: '  workflow  ' }),
      {} as never
    );

    expect(composed).toEqual({ prompt: 'Ticket T-100' });
    expect(truncated).toEqual({ text: 'workf...gner' });
    expect(concatenated).toEqual({ text: 'workflow designer' });
    expect(replaced).toEqual({ text: 'designer workflow' });
    expect(splitText).toEqual({ items: ['a', 'b'] });
    expect(joinedText).toEqual({ text: 'workflow::designer' });
    expect(lowercased).toEqual({ text: 'alga' });
    expect(uppercased).toEqual({ text: 'ALGA' });
    expect(trimmed).toEqual({ text: 'workflow' });
  });

  it('T261/T262/T264/T265/T266/T267: applies representative object, value, and array transforms through runtime handlers', async () => {
    const registry = getActionRegistryV2();

    const coalesce = registry.get('transform.coalesce_value', 1);
    const buildObject = registry.get('transform.build_object', 1);
    const pickFields = registry.get('transform.pick_fields', 1);
    const renameFields = registry.get('transform.rename_fields', 1);
    const appendArray = registry.get('transform.append_array', 1);
    const buildArray = registry.get('transform.build_array', 1);

    const coalesced = await coalesce?.handler(
      coalesce.inputSchema.parse({ candidates: [null, '', 'ticket-123'], treatEmptyStringAsMissing: true }),
      {} as never
    );
    const builtObject = await buildObject?.handler(
      buildObject.inputSchema.parse({ fields: [{ key: 'ticketId', value: 'ticket-123' }, { key: 'priority', value: 'high' }] }),
      {} as never
    );
    const pickedObject = await pickFields?.handler(
      pickFields.inputSchema.parse({ source: { ticketId: 'ticket-123', priority: 'high', ignored: true }, fields: ['priority', 'ticketId'] }),
      {} as never
    );
    const renamedObject = await renameFields?.handler(
      renameFields.inputSchema.parse({ source: { ticket_id: 'ticket-123', priority: 'high' }, renames: [{ from: 'ticket_id', to: 'ticketId' }] }),
      {} as never
    );
    const appendedArray = await appendArray?.handler(
      appendArray.inputSchema.parse({ items: ['ticket'], values: ['contact', 'client'] }),
      {} as never
    );
    const builtArray = await buildArray?.handler(
      buildArray.inputSchema.parse({ items: ['ticket', 42, { status: 'open' }] }),
      {} as never
    );

    expect(coalesced).toEqual({ value: 'ticket-123', matchedIndex: 2 });
    expect(builtObject).toEqual({ object: { ticketId: 'ticket-123', priority: 'high' } });
    expect(pickedObject).toEqual({ object: { priority: 'high', ticketId: 'ticket-123' } });
    expect(renamedObject).toEqual({ object: { ticketId: 'ticket-123', priority: 'high' } });
    expect(appendedArray).toEqual({ items: ['ticket', 'contact', 'client'] });
    expect(builtArray).toEqual({ items: ['ticket', 42, { status: 'open' }] });
  });

  it('accepts null pick_fields sources and treats them as empty objects', async () => {
    const registry = getActionRegistryV2();
    const pickFields = registry.get('transform.pick_fields', 1);

    const parsed = pickFields?.inputSchema.parse({ source: null, fields: ['ticketId'] });
    const pickedObject = await pickFields?.handler(parsed as never, {} as never);

    expect(parsed).toEqual({ source: null, fields: ['ticketId'] });
    expect(pickedObject).toEqual({ object: {} });
  });
});
