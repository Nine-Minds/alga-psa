import { describe, expect, it } from 'vitest';

import {
  COMPOSE_TEXT_ACTION_ID,
  COMPOSE_TEXT_VERSION,
  composeTextOutputsSchema,
  generateComposeTextStableKey,
  renderComposeTextOutputs,
  renderTemplateDocumentToMarkdown,
  templateDocumentSchema,
  validateComposeTextConfig,
} from '../composeText';

describe('composeText helpers', () => {
  it('T002: validates compose-text config outputs and rejects missing outputs', () => {
    const valid = validateComposeTextConfig({
      actionId: COMPOSE_TEXT_ACTION_ID,
      version: COMPOSE_TEXT_VERSION,
      outputs: [
        {
          id: 'out-1',
          label: 'Prompt',
          stableKey: 'prompt',
          document: {
            version: 1,
            blocks: [{ type: 'paragraph', children: [{ type: 'text', text: 'Hello' }] }],
          },
        },
      ],
    });
    const invalid = validateComposeTextConfig({
      actionId: COMPOSE_TEXT_ACTION_ID,
      version: COMPOSE_TEXT_VERSION,
    });

    expect(valid).toMatchObject({ ok: true });
    expect(invalid).toMatchObject({ ok: false });
    if (invalid.ok === false) {
      expect(invalid.errors[0]).toContain('at least one output');
    }
  });

  it('T003/T004: generates stable keys from freeform labels and disambiguates collisions', () => {
    expect(generateComposeTextStableKey('Prompt Body')).toBe('prompt_body');
    expect(generateComposeTextStableKey('123 Summary')).toBe('output_123_summary');
    expect(generateComposeTextStableKey('Prompt Body', ['prompt_body'])).toBe('prompt_body_2');
  });

  it('T006/T007/T008: rejects empty labels plus duplicate labels and stable keys', () => {
    const parsed = composeTextOutputsSchema.safeParse([
      {
        id: 'out-1',
        label: ' ',
        stableKey: 'prompt',
        document: { version: 1, blocks: [] },
      },
      {
        id: 'out-2',
        label: 'Prompt',
        stableKey: 'prompt',
        document: { version: 1, blocks: [] },
      },
      {
        id: 'out-3',
        label: 'prompt',
        stableKey: 'prompt_2',
        document: { version: 1, blocks: [] },
      },
    ]);

    expect(parsed.success).toBe(false);
    expect(parsed.success ? [] : parsed.error.issues.map((issue) => issue.message)).toEqual(
      expect.arrayContaining([
        'String must contain at least 1 character(s)',
        'Output labels must be unique within the step.',
        'Stable keys must be unique within the step.',
      ])
    );
  });

  it('T009/T010: restricts template documents to markdown-safe nodes with simple references only', () => {
    const valid = templateDocumentSchema.safeParse({
      version: 1,
      blocks: [
        {
          type: 'paragraph',
          children: [
            { type: 'text', text: 'Hello', marks: ['bold'] },
            { type: 'reference', path: 'payload.ticket.id', label: 'Ticket ID' },
          ],
        },
      ],
    });
    const invalidBlock = templateDocumentSchema.safeParse({
      version: 1,
      blocks: [{ type: 'table', children: [] }],
    });
    const invalidReference = templateDocumentSchema.safeParse({
      version: 1,
      blocks: [
        {
          type: 'paragraph',
          children: [{ type: 'reference', path: 'payload.ticket.id & payload.name', label: 'Bad' }],
        },
      ],
    });

    expect(valid.success).toBe(true);
    expect(invalidBlock.success).toBe(false);
    expect(invalidReference.success).toBe(false);
  });

  it('T014/T015/T016: renders paragraphs, hard breaks, lists, and inline formatting as markdown', async () => {
    const markdown = await renderTemplateDocumentToMarkdown(
      {
        version: 1,
        blocks: [
          {
            type: 'paragraph',
            children: [{ type: 'text', text: 'Line 1\nLine 2' }],
          },
          {
            type: 'bullet_list_item',
            children: [{ type: 'text', text: 'One', marks: ['bold'] }],
          },
          {
            type: 'bullet_list_item',
            children: [{ type: 'text', text: 'Two', marks: ['italic', 'code'] }],
          },
          {
            type: 'ordered_list_item',
            children: [{ type: 'text', text: 'Three', marks: ['link'], href: 'https://example.com' }],
          },
        ],
      },
      { outputKey: 'prompt' }
    );

    expect(markdown).toBe(
      'Line 1  \nLine 2\n\n- **One**\n- _`Two`_\n\n1. [Three](https://example.com)'
    );
  });

  it('T017/T018/T019/T020/T021: renders multiple outputs from payload and vars references and fails on missing references', async () => {
    const config = {
      actionId: COMPOSE_TEXT_ACTION_ID,
      version: COMPOSE_TEXT_VERSION,
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
        {
          id: 'out-2',
          label: 'Summary',
          stableKey: 'summary',
          document: {
            version: 1,
            blocks: [
              {
                type: 'paragraph',
                children: [
                  { type: 'reference', path: 'vars.ticketResult.updated', label: 'Updated' },
                  { type: 'text', text: ' / ' },
                  { type: 'reference', path: 'vars.ticketResult.ticket_id', label: 'Ticket ID' },
                ],
              },
            ],
          },
        },
      ],
    };

    const rendered = await renderComposeTextOutputs(config, {
      payload: { ticket: { id: 'T-100' } },
      vars: { ticketResult: { updated: true, ticket_id: 'T-100' } },
      meta: {},
      error: undefined,
    });

    expect(rendered).toEqual({
      prompt: 'Ticket T-100',
      summary: 'true / T-100',
    });

    await expect(
      renderComposeTextOutputs(
        {
          ...config,
          outputs: [
            ...config.outputs,
            {
              id: 'out-3',
              label: 'Missing',
              stableKey: 'missing',
              document: {
                version: 1,
                blocks: [
                  {
                    type: 'paragraph',
                    children: [{ type: 'reference', path: 'vars.ticketResult.subject', label: 'Subject' }],
                  },
                ],
              },
            },
          ],
        },
        {
          payload: { ticket: { id: 'T-100' } },
          vars: { ticketResult: { updated: true, ticket_id: 'T-100' } },
          meta: {},
          error: undefined,
        }
      )
    ).rejects.toMatchObject({
      category: 'ValidationError',
      code: 'MISSING_REFERENCE',
      details: {
        outputKey: 'missing',
        referencePath: 'vars.ticketResult.subject',
      },
    });
  });
});
