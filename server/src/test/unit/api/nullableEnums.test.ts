import { describe, expect, it } from 'vitest';
import { includeNullInNullableEnums } from '../../../lib/api/openapi/nullableEnums';

describe('includeNullInNullableEnums', () => {
  it('appends null to enums of schemas nullable by type, at any depth', () => {
    const doc = {
      components: {
        schemas: {
          A: {
            type: 'object',
            properties: {
              status: { type: ['string', 'null'], enum: ['a', 'b'] },
              list: { type: 'array', items: { type: ['string', 'null'], enum: ['x'] } },
              either: { anyOf: [{ type: ['string', 'null'], enum: ['y'] }] },
              extra: { type: 'object', additionalProperties: { type: ['string', 'null'], enum: ['z'] } },
            },
          },
        },
      },
      paths: { '/p': { get: { parameters: [{ schema: { type: ['string', 'null'], enum: ['q'] } }] } } },
    };
    const out: any = includeNullInNullableEnums(doc);
    const props = out.components.schemas.A.properties;
    expect(props.status.enum).toEqual(['a', 'b', null]);
    expect(props.list.items.enum).toEqual(['x', null]);
    expect(props.either.anyOf[0].enum).toEqual(['y', null]);
    expect(props.extra.additionalProperties.enum).toEqual(['z', null]);
    expect(out.paths['/p'].get.parameters[0].schema.enum).toEqual(['q', null]);
  });

  it('leaves non-nullable enums alone, is idempotent and does not mutate its input', () => {
    const doc = { a: { type: 'string', enum: ['a'] }, b: { type: ['string', 'null'], enum: ['b'] } };
    const snapshot = JSON.stringify(doc);
    const once = includeNullInNullableEnums(doc);
    expect(JSON.stringify(doc)).toBe(snapshot);
    expect(once.a.enum).toEqual(['a']);
    expect(includeNullInNullableEnums(once)).toEqual(once);
    expect(once.b.enum).toEqual(['b', null]);
  });
});
