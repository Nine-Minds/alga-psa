import { describe, expect, it } from 'vitest';
import { buildReadAttachmentRequest, ReadAttachmentInputError } from '../buildReadAttachmentRequest';
import { redactToolResult } from '../redactToolArguments';

describe('buildReadAttachmentRequest', () => {
  it('maps arguments onto GET /api/v1/documents/content', () => {
    expect(buildReadAttachmentRequest({ entity_type: 'ticket', entity_id: ' SR000674 ', document_id: 'd1', cursor: 'c' })).toEqual({
      method: 'GET',
      path: '/api/v1/documents/content',
      query: { entity_type: 'ticket', entity_id: 'SR000674', document_id: 'd1', cursor: 'c' },
      headers: {},
      isMutation: false,
    });
  });

  it('omits empty optional parameters', () => {
    expect(buildReadAttachmentRequest({ entity_type: 'ticket', entity_id: 'x', document_id: '', cursor: ' ' }).query).toEqual({
      entity_type: 'ticket',
      entity_id: 'x',
    });
  });

  it('fails fast on a bad entity_type or missing entity_id', () => {
    expect(() => buildReadAttachmentRequest({ entity_type: 'asset', entity_id: 'x' })).toThrow(ReadAttachmentInputError);
    expect(() => buildReadAttachmentRequest({ entity_type: 'ticket' })).toThrow(ReadAttachmentInputError);
    expect(() => buildReadAttachmentRequest(undefined)).toThrow(ReadAttachmentInputError);
  });
});

describe('redactToolResult read_attachment', () => {
  it('keeps names, counts and the cursor only', () => {
    const header = {
      entity: { type: 'ticket', id: 't', label: 'SR1' },
      served: [{ document_id: 'd', name: 'a.jpg', mime_type: 'image/jpeg' }],
      omitted: [{ document_id: 'e', name: 'b.heic', reason: 'unreadable_image' }],
      next_cursor: 'abc',
    };
    expect(JSON.parse(redactToolResult('read_attachment', JSON.stringify(header)) as string)).toEqual({
      served_count: 1,
      served: ['a.jpg'],
      omitted_count: 1,
      omitted: [{ name: 'b.heic', reason: 'unreadable_image' }],
      next_cursor: 'abc',
    });
  });
});
