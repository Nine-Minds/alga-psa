import { describe, expect, it } from 'vitest';
import { isAwaitingPreview, PREVIEW_POLL_WINDOW_MS } from './documentPreviewPending';

const now = new Date('2026-01-01T12:00:00Z').getTime();
const recent = new Date(now - 60_000);
const base = { mime_type: 'image/png', file_id: 'f1', updated_at: recent } as any;

describe('isAwaitingPreview', () => {
  it('is true for a recent previewable mime type without a preview', () => {
    expect(isAwaitingPreview(base, now)).toBe(true);
    expect(isAwaitingPreview({ ...base, mime_type: 'application/pdf' }, now)).toBe(true);
    expect(isAwaitingPreview({ ...base, mime_type: 'video/x-matroska' }, now)).toBe(true);
  });
  it('is false for a non-previewable mime type', () => {
    expect(isAwaitingPreview({ ...base, mime_type: 'text/plain' }, now)).toBe(false);
  });
  it('is false for an old document', () => {
    expect(isAwaitingPreview({ ...base, updated_at: new Date(now - PREVIEW_POLL_WINDOW_MS - 1) }, now)).toBe(false);
  });
  it('is false once a preview exists', () => {
    expect(isAwaitingPreview({ ...base, preview_file_id: 'p1' }, now)).toBe(false);
    expect(isAwaitingPreview({ ...base, thumbnail_file_id: 't1' }, now)).toBe(false);
    expect(isAwaitingPreview({ ...base, preview_generated_at: recent }, now)).toBe(false);
  });
});
