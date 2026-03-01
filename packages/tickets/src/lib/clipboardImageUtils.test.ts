import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MAX_CLIPBOARD_IMAGE_BYTES,
  createClipboardImageFilename,
  extractClipboardImageFiles,
  validateClipboardImageFile,
} from './clipboardImageUtils';

describe('clipboardImageUtils', () => {
  it('T001: identifies clipboard image MIME entries and ignores non-image entries', () => {
    const imageFile = new File(['img'], 'image.png', { type: 'image/png' });
    const textFile = new File(['txt'], 'notes.txt', { type: 'text/plain' });

    const items = [
      {
        kind: 'file',
        type: 'image/png',
        getAsFile: () => imageFile,
      },
      {
        kind: 'file',
        type: 'text/plain',
        getAsFile: () => textFile,
      },
      {
        kind: 'string',
        type: 'text/plain',
        getAsFile: () => null,
      },
    ];

    const extracted = extractClipboardImageFiles(items);
    expect(extracted).toHaveLength(1);
    expect(extracted[0]).toBe(imageFile);
  });

  it('T002: preserves deterministic clipboard image ordering', () => {
    const first = new File(['1'], 'a.png', { type: 'image/png' });
    const second = new File(['2'], 'b.jpg', { type: 'image/jpeg' });

    const items = [
      { kind: 'file', type: 'image/png', getAsFile: () => first },
      { kind: 'file', type: 'image/jpeg', getAsFile: () => second },
    ];

    const extracted = extractClipboardImageFiles(items);
    expect(extracted.map((item) => item.name)).toEqual(['a.png', 'b.jpg']);
  });

  it('T005: deterministic filename generator follows expected pattern', () => {
    const filename = createClipboardImageFilename({
      timestamp: new Date('2026-03-01T14:15:16.000Z'),
      sequence: 7,
      mimeType: 'image/jpeg',
    });

    expect(filename).toBe('clipboard-image-20260301-141516-007.jpg');
  });

  it('T025: rejects unsupported MIME types before upload', () => {
    const validation = validateClipboardImageFile({
      type: 'text/plain',
      size: 32,
    } as File);

    expect(validation.valid).toBe(false);
    expect(validation.error).toMatch(/Only image clipboard content/);
  });

  it('T026: rejects oversize clipboard images before upload', () => {
    const validation = validateClipboardImageFile(
      {
        type: 'image/png',
        size: DEFAULT_MAX_CLIPBOARD_IMAGE_BYTES + 1,
      } as File
    );

    expect(validation.valid).toBe(false);
    expect(validation.error).toMatch(/upload limit/i);
  });
});
