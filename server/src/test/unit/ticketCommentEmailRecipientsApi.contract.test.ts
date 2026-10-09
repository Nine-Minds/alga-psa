/* @vitest-environment node */

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { createTicketCommentSchema } from '../../lib/api/schemas/ticket';
import { chatApiRegistry as ceMcpRegistry } from '../../lib/mcp/registry.generated';
import { chatApiRegistry as eeMcpRegistry } from '../../../../ee/server/src/chat/registry/apiRegistry.generated';

const repoRoot = path.resolve(__dirname, '../../../..');
const COMMENT_OPERATION = ['post', '/api/v1/tickets/{id}/comments'] as const;

function resolveOpenApiSchema(spec: any, schema: any): any {
  if (!schema?.$ref) return schema;
  return schema.$ref
    .replace(/^#\//, '')
    .split('/')
    .reduce((value: any, key: string) => value?.[key], spec);
}

describe('createTicketCommentSchema cc/bcc', () => {
  it('T015: accepts cc and bcc on a public comment', () => {
    const parsed = createTicketCommentSchema.parse({
      comment_text: 'Looping in the vendor',
      cc: ['vendor@acme.com'],
      bcc: ['boss@msp.com'],
    });
    expect(parsed.cc).toEqual(['vendor@acme.com']);
    expect(parsed.bcc).toEqual(['boss@msp.com']);
  });

  it('T016: rejects an invalid email in cc with a cc field error', () => {
    const result = createTicketCommentSchema.safeParse({
      comment_text: 'Hello',
      cc: ['not-an-email'],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.errors.some((issue) => issue.path[0] === 'cc')).toBe(true);
    }
  });

  it('T017: rejects cc when is_internal is true', () => {
    const result = createTicketCommentSchema.safeParse({
      comment_text: 'Internal note',
      is_internal: true,
      cc: ['vendor@acme.com'],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.errors.some((issue) =>
        issue.path[0] === 'cc' && /internal note/i.test(issue.message)
      )).toBe(true);
    }
  });

  it('T017: rejects more than 20 combined recipients', () => {
    const many = (count: number, prefix: string) =>
      Array.from({ length: count }, (_, index) => `${prefix}${index}@example.com`);
    expect(createTicketCommentSchema.safeParse({
      comment_text: 'Hello',
      cc: many(10, 'cc'),
      bcc: many(10, 'bcc'),
    }).success).toBe(true);
    expect(createTicketCommentSchema.safeParse({
      comment_text: 'Hello',
      cc: many(11, 'cc'),
      bcc: many(10, 'bcc'),
    }).success).toBe(false);
  });

  it('T018: a body without cc/bcc stays backward compatible', () => {
    const parsed = createTicketCommentSchema.parse({ comment_text: 'Hello' });
    expect(parsed.cc).toBeUndefined();
    expect(parsed.bcc).toBeUndefined();
  });
});

describe('T020: generated API artifacts publish cc/bcc', () => {
  it.each(['ce', 'ee'] as const)('%s OpenAPI spec documents cc/bcc on the comment create body', (edition) => {
    const spec = JSON.parse(fs.readFileSync(
      path.join(repoRoot, `sdk/docs/openapi/alga-openapi.${edition}.json`),
      'utf8',
    ));
    const [method, operationPath] = COMMENT_OPERATION;
    const operation = spec.paths?.[operationPath]?.[method];
    const schema = resolveOpenApiSchema(
      spec,
      operation.requestBody?.content?.['application/json']?.schema,
    );
    for (const field of ['cc', 'bcc'] as const) {
      expect(schema?.properties?.[field]?.type).toBe('array');
      expect(schema?.properties?.[field]?.items?.format).toBe('email');
      expect(schema?.properties?.[field]?.maxItems).toBe(20);
    }
  });

  it.each([
    ['ce', ceMcpRegistry],
    ['ee', eeMcpRegistry],
  ] as const)('%s MCP registry exposes cc/bcc inputs', (_edition, registry) => {
    const [method, operationPath] = COMMENT_OPERATION;
    const entry = registry.find((candidate) =>
      candidate.method === method && candidate.path === operationPath
    );
    expect(entry).toBeTruthy();
    for (const field of ['cc', 'bcc'] as const) {
      expect((entry?.requestBodySchema as any)?.properties?.[field]?.type).toBe('array');
    }
  });
});
