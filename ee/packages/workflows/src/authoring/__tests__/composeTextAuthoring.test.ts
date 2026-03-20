import { describe, expect, it } from 'vitest';

import {
  buildComposeTextReferencePath,
  coerceComposeTextOutputs,
  COMPOSE_TEXT_REFERENCE_INLINE_CONTENT_TYPE,
  composeTextBlockNoteSchema,
  createComposeTextOutput,
  hydrateComposeTextDocumentToBlocks,
  isValidComposeTextStableKey,
  regenerateComposeTextOutputStableKey,
  renameComposeTextOutput,
  serializeComposeTextBlocksToDocument,
  validateComposeTextOutputs,
} from '../composeTextAuthoring';
import { templateDocumentSchema } from '../../../../../../shared/workflow/runtime/actions/composeText';

describe('composeTextAuthoring', () => {
  it('T003/T004: generates stable keys from freeform labels and disambiguates collisions for new outputs', () => {
    expect(createComposeTextOutput('Prompt Body', [], () => 'out-1')).toMatchObject({
      id: 'out-1',
      label: 'Prompt Body',
      stableKey: 'prompt_body',
    });
    expect(createComposeTextOutput('123 Summary', [], () => 'out-2').stableKey).toBe(
      'output_123_summary'
    );
    expect(
      createComposeTextOutput('Prompt Body', ['prompt_body'], () => 'out-3').stableKey
    ).toBe('prompt_body_2');
  });

  it('T005: renaming preserves the stable key by default, while regeneration uses the new label', () => {
    const output = createComposeTextOutput('Prompt', [], () => 'out-1');
    const renamed = renameComposeTextOutput(output, 'Follow Up Email');
    const regenerated = regenerateComposeTextOutputStableKey(renamed, [
      'summary',
      'follow_up_email',
      renamed.stableKey,
    ]);

    expect(renamed).toMatchObject({
      id: 'out-1',
      label: 'Follow Up Email',
      stableKey: 'prompt',
    });
    expect(regenerated.stableKey).toBe('follow_up_email_2');
  });

  it('T006/T007/T008: validates empty labels, duplicate labels, duplicate keys, and invalid stable keys', () => {
    const errors = validateComposeTextOutputs([
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
        stableKey: 'Invalid-Key',
        document: { version: 1, blocks: [] },
      },
    ]);

    expect(errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          outputId: 'out-1',
          field: 'label',
          message: 'String must contain at least 1 character(s)',
        }),
        expect.objectContaining({
          outputId: 'out-2',
          field: 'stableKey',
          message: 'Stable keys must be unique within the step.',
        }),
        expect.objectContaining({
          outputId: 'out-3',
          field: 'label',
          message: 'Output labels must be unique within the step.',
        }),
        expect.objectContaining({
          outputId: 'out-3',
          field: 'stableKey',
          message: 'Stable keys must be lowercase snake_case identifiers.',
        }),
      ])
    );
    expect(isValidComposeTextStableKey('email_body')).toBe(true);
    expect(isValidComposeTextStableKey('Email Body')).toBe(false);
  });

  it('T009/T010: restricts template documents to markdown-safe nodes and simple reference paths', () => {
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
          children: [
            { type: 'reference', path: 'payload.ticket.id || payload.ticket.number', label: 'Bad' },
          ],
        },
      ],
    });

    expect(valid.success).toBe(true);
    expect(invalidBlock.success).toBe(false);
    expect(invalidReference.success).toBe(false);
  });

  it('T011/T012/T044: round-trips markdown-safe blocks and inline chips without leaking BlockNote node shapes', () => {
    const blocks = [
      {
        type: 'heading',
        props: { level: 2 },
        content: [{ type: 'text', text: 'Escalation', styles: { bold: true } }],
      },
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: 'Ticket ', styles: {} },
          {
            type: COMPOSE_TEXT_REFERENCE_INLINE_CONTENT_TYPE,
            props: { path: 'payload.ticket.id', label: 'Ticket ID' },
          },
          {
            type: 'link',
            href: 'https://example.com',
            content: [{ type: 'text', text: ' details', styles: { italic: true } }],
          },
        ],
      },
      {
        type: 'bulletListItem',
        content: [{ type: 'text', text: 'First item', styles: { code: true } }],
      },
      {
        type: 'quote',
        content: [{ type: 'text', text: 'Need approval', styles: {} }],
      },
      {
        type: 'codeBlock',
        content: 'return true;',
      },
    ] as any;

    const document = serializeComposeTextBlocksToDocument(blocks);

    expect(document).toEqual({
      version: 1,
      blocks: [
        {
          type: 'heading',
          level: 2,
          children: [{ type: 'text', text: 'Escalation', marks: ['bold'] }],
        },
        {
          type: 'paragraph',
          children: [
            { type: 'text', text: 'Ticket ', marks: undefined },
            { type: 'reference', path: 'payload.ticket.id', label: 'Ticket ID' },
            {
              type: 'text',
              text: ' details',
              marks: ['italic', 'link'],
              href: 'https://example.com',
            },
          ],
        },
        {
          type: 'bullet_list_item',
          children: [{ type: 'text', text: 'First item', marks: ['code'] }],
        },
        {
          type: 'blockquote',
          children: [{ type: 'text', text: 'Need approval', marks: undefined }],
        },
        {
          type: 'code_block',
          text: 'return true;',
        },
      ],
    });
    expect(JSON.stringify(document)).not.toContain(COMPOSE_TEXT_REFERENCE_INLINE_CONTENT_TYPE);
    expect(JSON.stringify(document)).not.toContain('bulletListItem');
    expect(JSON.stringify(document)).not.toContain('image');

    const hydrated = hydrateComposeTextDocumentToBlocks(document);
    expect(hydrated).toEqual([
      {
        type: 'heading',
        props: { level: 2 },
        content: [{ type: 'text', text: 'Escalation', styles: { bold: true } }],
      },
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: 'Ticket ', styles: {} },
          {
            type: COMPOSE_TEXT_REFERENCE_INLINE_CONTENT_TYPE,
            props: { path: 'payload.ticket.id', label: 'Ticket ID' },
          },
          {
            type: 'link',
            href: 'https://example.com',
            content: [{ type: 'text', text: ' details', styles: { italic: true } }],
          },
        ],
      },
      {
        type: 'bulletListItem',
        content: [{ type: 'text', text: 'First item', styles: { code: true } }],
      },
      {
        type: 'quote',
        content: [{ type: 'text', text: 'Need approval', styles: {} }],
      },
      {
        type: 'codeBlock',
        content: 'return true;',
      },
    ]);
  });

  it('T012/T013: exposes the constrained BlockNote schema with the custom inline reference chip type only', () => {
    const blockSpecs = (composeTextBlockNoteSchema as any).blockSpecs as Record<string, unknown>;
    const inlineContentSpecs = (composeTextBlockNoteSchema as any).inlineContentSpecs as Record<
      string,
      unknown
    >;

    expect(Object.keys(blockSpecs)).toEqual(
      expect.arrayContaining([
        'paragraph',
        'heading',
        'bulletListItem',
        'numberedListItem',
        'quote',
        'codeBlock',
      ])
    );
    expect(blockSpecs).not.toHaveProperty('image');
    expect(blockSpecs).not.toHaveProperty('file');
    expect(blockSpecs).not.toHaveProperty('audio');
    expect(blockSpecs).not.toHaveProperty('video');
    expect(blockSpecs).not.toHaveProperty('table');
    expect(blockSpecs).not.toHaveProperty('checkListItem');
    expect(blockSpecs).not.toHaveProperty('toggleListItem');
    expect(inlineContentSpecs).toHaveProperty(COMPOSE_TEXT_REFERENCE_INLINE_CONTENT_TYPE);
  });

  it('coerces incomplete outputs and builds downstream reference paths for valid keys', () => {
    expect(
      coerceComposeTextOutputs([
        {
          label: 'Prompt',
          stableKey: 'prompt',
          document: { version: 1, blocks: [{ type: 'table', children: [] }] },
        },
      ])
    ).toEqual([
      {
        id: 'compose-text-output-1',
        label: 'Prompt',
        stableKey: 'prompt',
        document: { version: 1, blocks: [] },
      },
    ]);
    expect(buildComposeTextReferencePath('composed', 'prompt')).toBe('vars.composed.prompt');
    expect(buildComposeTextReferencePath('', 'prompt')).toBeNull();
  });
});
