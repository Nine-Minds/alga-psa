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
      'transform.parse_json',
      'transform.query_json',
      'transform.stringify_json',
      'transform.regex_match',
      'transform.regex_extract',
      'transform.regex_replace',
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
    expect(registry.get('transform.parse_json', 1)?.outputSchema.safeParse({ value: { a: 1 }, type: 'object' }).success).toBe(true);
    expect(registry.get('transform.query_json', 1)?.outputSchema.safeParse({ value: { a: 1 } }).success).toBe(true);
    expect(registry.get('transform.stringify_json', 1)?.outputSchema.safeParse({ text: '{"a":1}' }).success).toBe(true);
    expect(registry.get('transform.regex_match', 1)?.outputSchema.safeParse({
      matched: true, match: 'INC-123456', index: 0, groups: ['123456'], namedGroups: {}
    }).success).toBe(true);
    expect(registry.get('transform.regex_extract', 1)?.outputSchema.safeParse({
      matched: true, count: 1, first: { text: 'INC-123456', index: 0, groups: ['123456'], namedGroups: {} }, matches: []
    }).success).toBe(true);
    expect(registry.get('transform.regex_replace', 1)?.outputSchema.safeParse({ text: 'value', replacementCount: 1 }).success).toBe(true);
    expect(registry.get('transform.compose_text', 1)?.outputSchema.safeParse({ prompt: 'abc' }).success).toBe(true);
    expect(registry.get('transform.concat_text', 1)?.outputSchema.safeParse({ text: 'abc' }).success).toBe(true);
    expect(registry.get('transform.replace_text', 1)?.outputSchema.safeParse({ text: 'abc' }).success).toBe(true);
    expect(registry.get('transform.split_text', 1)?.outputSchema.safeParse({ items: ['a', 'b'] }).success).toBe(true);
    expect(registry.get('transform.join_text', 1)?.outputSchema.safeParse({ text: 'abc' }).success).toBe(true);
    expect(registry.get('transform.lowercase_text', 1)?.outputSchema.safeParse({ text: 'abc' }).success).toBe(true);
    expect(registry.get('transform.uppercase_text', 1)?.outputSchema.safeParse({ text: 'ABC' }).success).toBe(true);
    expect(registry.get('transform.trim_text', 1)?.outputSchema.safeParse({ text: 'abc' }).success).toBe(true);
  });

  it('fails Parse JSON numeric overflow with a clear finite-value parse error', async () => {
    const registry = getActionRegistryV2();
    const parseJson = registry.get('transform.parse_json', 1);

    await expect(parseJson?.handler(parseJson.inputSchema.parse({ source: '1e999' }), {} as never))
      .rejects.toThrow('JSON parse failed: parsed value is not a finite JSON value');
  });

  it('requires transform source/value schema fields instead of accepting missing unknown values', () => {
    const registry = getActionRegistryV2();

    expect(registry.get('transform.parse_json', 1)?.inputSchema.safeParse({}).success).toBe(false);
    expect(registry.get('transform.query_json', 1)?.inputSchema.safeParse({ expression: 'source' }).success).toBe(false);
    expect(registry.get('transform.stringify_json', 1)?.inputSchema.safeParse({}).success).toBe(false);
    expect(registry.get('transform.query_json', 1)?.outputSchema.safeParse({}).success).toBe(false);
    expect(registry.get('transform.query_json', 1)?.outputSchema.safeParse({ value: undefined }).success).toBe(false);
    expect(registry.get('transform.regex_match', 1)?.inputSchema.safeParse({ pattern: 'INC-(\\d+)' }).success).toBe(false);
    expect(registry.get('transform.regex_extract', 1)?.inputSchema.safeParse({ pattern: 'INC-(\\d+)' }).success).toBe(false);
    expect(registry.get('transform.regex_replace', 1)?.inputSchema.safeParse({ pattern: 'INC-(\\d+)', replacement: 'REF-$1' }).success).toBe(false);
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

  it('T001/T002/T003/T004/T005/T006/T007/T008/T010/T011/T016: executes JSON transform actions with parse/query/stringify coverage', async () => {
    const registry = getActionRegistryV2();
    const parseJson = registry.get('transform.parse_json', 1);
    const queryJson = registry.get('transform.query_json', 1);
    const stringifyJson = registry.get('transform.stringify_json', 1);

    const parsedObject = await parseJson?.handler(
      parseJson.inputSchema.parse({ source: '{"customer":{"email":"owner@example.com"},"active":true}' }),
      {} as never
    );
    const parsedArray = await parseJson?.handler(
      parseJson.inputSchema.parse({ source: '[1,2,3]' }),
      {} as never
    );
    const parsedNumber = await parseJson?.handler(
      parseJson.inputSchema.parse({ source: '42' }),
      {} as never
    );
    const parsedString = await parseJson?.handler(
      parseJson.inputSchema.parse({ source: '"hello"' }),
      {} as never
    );
    const parsedNull = await parseJson?.handler(
      parseJson.inputSchema.parse({ source: 'null' }),
      {} as never
    );
    const passthroughObject = await parseJson?.handler(
      parseJson.inputSchema.parse({ source: { nested: { id: 'a1' } } }),
      {} as never
    );
    const passthroughArray = await parseJson?.handler(
      parseJson.inputSchema.parse({ source: [{ id: 1 }, { id: 2 }] }),
      {} as never
    );

    const queried = await queryJson?.handler(
      queryJson.inputSchema.parse({
        source: { customer: { email: 'owner@example.com' }, assets: [{ tag: 'srv-1' }, { tag: 'srv-2' }] },
        expression: '{"email": source.customer.email, "tags": source.assets.tag}'
      }),
      {
        expressionContext: {
          payload: { workflowName: 'Normalize inbound payload' },
          vars: { fallbackEmail: 'fallback@example.com' },
          meta: { runId: 'run-123' },
          error: { message: 'none' }
        }
      } as never
    );

    const queriedWithWorkflowContext = await queryJson?.handler(
      queryJson.inputSchema.parse({
        source: { customer: {} },
        expression: 'coalesce(source.customer.email, vars.fallbackEmail)'
      }),
      {
        expressionContext: {
          payload: { tenant: 'alpha' },
          vars: { fallbackEmail: 'fallback@example.com' },
          meta: { workflowVersion: 1 },
          error: null
        }
      } as never
    );

    const compactJson = await stringifyJson?.handler(
      stringifyJson.inputSchema.parse({ source: { customer: 'owner@example.com', tags: ['srv-1', 'srv-2'] } }),
      {} as never
    );
    const prettyJson = await stringifyJson?.handler(
      stringifyJson.inputSchema.parse({ source: { customer: 'owner@example.com', tags: ['srv-1', 'srv-2'] }, spacing: 2 }),
      {} as never
    );

    await expect(
      parseJson?.handler(parseJson.inputSchema.parse({ source: '{bad json]' }), {} as never)
    ).rejects.toThrow('JSON parse failed:');
    await expect(
      parseJson?.handler(parseJson.inputSchema.parse({ source: '1e999' }), {} as never)
    ).rejects.toThrow('JSON parse failed: parsed value is not a finite JSON value');

    await expect(
      queryJson?.handler(queryJson.inputSchema.parse({ source: { ids: [1, 2] }, expression: '$sum(source.ids)' }), {} as never)
    ).rejects.toThrow('JSON query expression validation failed:');

    await expect(
      queryJson?.handler(queryJson.inputSchema.parse({ source: { missing: true }, expression: 'source.nope' }), {} as never)
    ).rejects.toThrow('JSON query expression evaluation failed:');

    const largeText = 'x'.repeat(256 * 1024 + 8);
    await expect(
      queryJson?.handler(queryJson.inputSchema.parse({ source: { largeText }, expression: 'source.largeText' }), {} as never)
    ).rejects.toThrow('max output size');

    expect(parsedObject).toEqual({
      value: { customer: { email: 'owner@example.com' }, active: true },
      type: 'object'
    });
    expect(parsedArray).toEqual({ value: [1, 2, 3], type: 'array' });
    expect(parsedNumber).toEqual({ value: 42, type: 'number' });
    expect(parsedString).toEqual({ value: 'hello', type: 'string' });
    expect(parsedNull).toEqual({ value: null, type: 'null' });
    expect(passthroughObject).toEqual({ value: { nested: { id: 'a1' } }, type: 'object' });
    expect(passthroughArray).toEqual({ value: [{ id: 1 }, { id: 2 }], type: 'array' });
    expect((queried as any)?.value?.email).toBe('owner@example.com');
    expect(JSON.parse(JSON.stringify((queried as any)?.value?.tags))).toEqual(['srv-1', 'srv-2']);
    expect(queriedWithWorkflowContext).toEqual({ value: 'fallback@example.com' });
    expect(compactJson).toEqual({ text: '{"customer":"owner@example.com","tags":["srv-1","srv-2"]}' });
    expect(prettyJson).toEqual({ text: '{\n  "customer": "owner@example.com",\n  "tags": [\n    "srv-1",\n    "srv-2"\n  ]\n}' });
  });

  it('T001/T002/T003/T004/T005/T006/T007/T008/T009/T010/T011/T012: executes regex transforms with deterministic outputs and validation errors', async () => {
    const registry = getActionRegistryV2();
    const regexMatch = registry.get('transform.regex_match', 1);
    const regexExtract = registry.get('transform.regex_extract', 1);
    const regexReplace = registry.get('transform.regex_replace', 1);

    const noMatch = await regexMatch?.handler(
      regexMatch.inputSchema.parse({ text: 'No incident here', pattern: 'INC-(\\d{6})' }),
      {} as never
    );
    expect(noMatch).toEqual({
      matched: false,
      match: null,
      index: null,
      groups: [],
      namedGroups: {},
    });

    const matched = await regexMatch?.handler(
      regexMatch.inputSchema.parse({ text: 'Incident INC-123456 on srv-01', pattern: 'INC-(?<id>\\d{6})' }),
      {} as never
    );
    expect(matched).toEqual({
      matched: true,
      match: 'INC-123456',
      index: 9,
      groups: ['123456'],
      namedGroups: { id: '123456' },
    });

    const extracted = await regexExtract?.handler(
      regexExtract.inputSchema.parse({ text: 'A-1 B-2 C-3', pattern: '([A-Z])-(?<n>\\d)', maxMatches: 2 }),
      {} as never
    );
    expect(extracted).toEqual({
      matched: true,
      count: 2,
      first: { text: 'A-1', index: 0, groups: ['A', '1'], namedGroups: { n: '1' } },
      matches: [
        { text: 'A-1', index: 0, groups: ['A', '1'], namedGroups: { n: '1' } },
        { text: 'B-2', index: 4, groups: ['B', '2'], namedGroups: { n: '2' } },
      ],
    });

    const firstOnlyReplace = await regexReplace?.handler(
      regexReplace.inputSchema.parse({ text: 'host host host', pattern: 'host', replacement: 'node', replaceAll: false }),
      {} as never
    );
    const replaceAll = await regexReplace?.handler(
      regexReplace.inputSchema.parse({ text: 'INC-123 INC-456', pattern: 'INC-(\\d+)', replacement: 'REF-$1', replaceAll: true }),
      {} as never
    );
    const replaceNamed = await regexReplace?.handler(
      regexReplace.inputSchema.parse({ text: 'srv-001', pattern: 'srv-(?<id>\\d+)', replacement: 'host-$<id>' }),
      {} as never
    );
    const stickyFirstOnlyReplace = await regexReplace?.handler(
      regexReplace.inputSchema.parse({ text: 'alpha alpha', pattern: 'alpha', flags: 'y', replacement: 'beta', replaceAll: false }),
      {} as never
    );
    expect(firstOnlyReplace).toEqual({ text: 'node host host', replacementCount: 1 });
    expect(replaceAll).toEqual({ text: 'REF-123 REF-456', replacementCount: 2 });
    expect(replaceNamed).toEqual({ text: 'host-001', replacementCount: 1 });
    expect(stickyFirstOnlyReplace).toEqual({ text: 'beta alpha', replacementCount: 1 });

    const zeroWidth = await regexExtract?.handler(
      regexExtract.inputSchema.parse({ text: 'abc', pattern: '^', flags: 'gm', maxMatches: 5 }),
      {} as never
    );
    expect(zeroWidth).toMatchObject({ matched: true, count: 1 });

    await expect(
      regexMatch?.handler(regexMatch.inputSchema.parse({ text: 'abc', pattern: '(' }), {} as never)
    ).rejects.toThrow('invalid regex pattern');
    await expect(
      regexMatch?.handler(regexMatch.inputSchema.parse({ text: 'abc', pattern: 'a', flags: 'gg' }), {} as never)
    ).rejects.toThrow('duplicate flag');
    await expect(
      regexMatch?.handler(regexMatch.inputSchema.parse({ text: 'abc', pattern: 'a', flags: 'z' }), {} as never)
    ).rejects.toThrow('unsupported flag');
    await expect(
      regexExtract?.handler(regexExtract.inputSchema.parse({ text: 'x '.repeat(100_001), pattern: 'x' }), {} as never)
    ).rejects.toThrow('text length');
    const cappedMatches = await regexExtract?.handler(
      regexExtract.inputSchema.parse({ text: 'a a a', pattern: 'a', maxMatches: 1 }),
      {} as never
    );
    expect(cappedMatches).toMatchObject({ count: 1, matched: true });
    await expect(
      regexExtract?.handler(regexExtract.inputSchema.parse({ text: 'a', pattern: 'a', maxMatches: 1001 }), {} as never)
    ).rejects.toThrow('maxMatches 1001 exceeds maximum 1000');
    await expect(
      regexExtract?.handler(regexExtract.inputSchema.parse({ text: 'nope', pattern: 'INC-(\\d+)', requireMatch: true }), {} as never)
    ).rejects.toThrow('requireMatch is true');
    await expect(
      regexMatch?.handler(regexMatch.inputSchema.parse({ text: 'nope', pattern: 'INC-(\\d+)', requireMatch: true }), {} as never)
    ).rejects.toThrow('requireMatch is true');
  });
});
