import { describe, expect, it } from 'vitest';

import {
  coerceComposeTextOutputs,
  createComposeTextOutput,
  serializeComposeTextBlocksToDocument,
  hydrateComposeTextDocumentToBlocks,
  validateComposeTextOutputs,
} from '../workflowComposeTextUtils';
import { composeTextBlockNoteSchema } from '../WorkflowComposeTextDocumentEditor';

describe('workflowComposeTextUtils', () => {
  it('T005: persisted compose-text outputs keep their stable keys even when labels change later', () => {
    const outputs = coerceComposeTextOutputs([
      {
        id: 'out-1',
        label: 'Original Prompt',
        stableKey: 'prompt',
        document: { version: 1, blocks: [] },
      },
      {
        id: 'out-1',
        label: 'Renamed Prompt',
        stableKey: 'prompt',
        document: { version: 1, blocks: [] },
      },
    ]);

    expect(outputs[0]?.stableKey).toBe('prompt');
    expect(outputs[1]?.stableKey).toBe('prompt');
  });

  it('T011/T012/T044: serializes and hydrates markdown-safe blocks, formatting, and reference chips without leaking BlockNote node types', () => {
    const blocks = [
      {
        type: 'heading',
        props: { level: 2 },
        content: [
          { type: 'text', text: 'Escalation', styles: { bold: true } },
        ],
      },
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: 'Ticket ', styles: {} },
          { type: 'workflowReference', props: { path: 'payload.ticket.id', label: 'Ticket ID' } },
          {
            type: 'link',
            href: 'https://example.com',
            content: [{ type: 'text', text: ' details', styles: { italic: true } }],
          },
        ],
      },
      {
        type: 'bulletListItem',
        content: [
          { type: 'text', text: 'First item', styles: { code: true } },
        ],
      },
      {
        type: 'quote',
        content: [
          { type: 'text', text: 'Need approval', styles: {} },
        ],
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
            { type: 'text', text: ' details', marks: ['italic', 'link'], href: 'https://example.com' },
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
    expect(JSON.stringify(document)).not.toContain('workflowReference');
    expect(JSON.stringify(document)).not.toContain('bulletListItem');
    expect(JSON.stringify(document)).not.toContain('numberedListItem');
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
          { type: 'workflowReference', props: { path: 'payload.ticket.id', label: 'Ticket ID' } },
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

  it('T013: the constrained BlockNote schema omits media, tables, and unsupported checklist/toggle blocks', () => {
    const blockSpecs = (composeTextBlockNoteSchema as any).blockSpecs as Record<string, unknown>;

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
  });

  it('creates stable keys for new outputs and validates duplicate labels/keys', () => {
    const output = createComposeTextOutput('Email Body', ['prompt'], () => 'out-2');
    const validations = validateComposeTextOutputs([
      {
        id: 'out-1',
        label: 'Prompt',
        stableKey: 'prompt',
        document: { version: 1, blocks: [] },
      },
      {
        ...output,
        label: 'Prompt',
        stableKey: 'prompt',
      },
    ]);

    expect(output).toMatchObject({
      id: 'out-2',
      label: 'Email Body',
      stableKey: 'email_body',
    });
    expect(validations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: 'label', message: 'Output labels must be unique within the step.' }),
        expect.objectContaining({ field: 'stableKey', message: 'Stable keys must be unique within the step.' }),
      ])
    );
  });
});
