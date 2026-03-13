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
      'transform.truncate_text',
      'transform.concat_text',
      'transform.replace_text',
      'transform.split_text',
      'transform.join_text',
      'transform.lowercase_text',
      'transform.uppercase_text',
      'transform.trim_text',
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
    expect(registry.get('transform.concat_text', 1)?.outputSchema.safeParse({ text: 'abc' }).success).toBe(true);
    expect(registry.get('transform.replace_text', 1)?.outputSchema.safeParse({ text: 'abc' }).success).toBe(true);
    expect(registry.get('transform.split_text', 1)?.outputSchema.safeParse({ items: ['a', 'b'] }).success).toBe(true);
    expect(registry.get('transform.join_text', 1)?.outputSchema.safeParse({ text: 'abc' }).success).toBe(true);
    expect(registry.get('transform.lowercase_text', 1)?.outputSchema.safeParse({ text: 'abc' }).success).toBe(true);
    expect(registry.get('transform.uppercase_text', 1)?.outputSchema.safeParse({ text: 'ABC' }).success).toBe(true);
    expect(registry.get('transform.trim_text', 1)?.outputSchema.safeParse({ text: 'abc' }).success).toBe(true);
  });

  it('applies representative text transforms through runtime handlers', async () => {
    const registry = getActionRegistryV2();

    const truncate = registry.get('transform.truncate_text', 1);
    const concat = registry.get('transform.concat_text', 1);
    const split = registry.get('transform.split_text', 1);
    const uppercase = registry.get('transform.uppercase_text', 1);

    const truncated = await truncate?.handler(
      truncate.inputSchema.parse({ text: 'workflow designer', maxLength: 12, strategy: 'middle', ellipsis: '...' }),
      {} as never
    );
    const concatenated = await concat?.handler(
      concat.inputSchema.parse({ values: ['workflow', 'designer'], separator: ' ' }),
      {} as never
    );
    const splitText = await split?.handler(
      split.inputSchema.parse({ text: 'a,,b', delimiter: ',', removeEmpty: true }),
      {} as never
    );
    const uppercased = await uppercase?.handler(
      uppercase.inputSchema.parse({ text: 'alga' }),
      {} as never
    );

    expect(truncated).toEqual({ text: 'workf...gner' });
    expect(concatenated).toEqual({ text: 'workflow designer' });
    expect(splitText).toEqual({ items: ['a', 'b'] });
    expect(uppercased).toEqual({ text: 'ALGA' });
  });
});
