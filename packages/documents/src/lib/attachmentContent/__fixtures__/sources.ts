import type { AttachmentSource } from '../types';

export function fileSource(
  name: string,
  mime: string | null,
  bytes: Buffer,
  extra: { fileSize?: number | null; updated_at?: string; loadBytes?: () => Promise<Buffer>; id?: string } = {},
): AttachmentSource & { loads: () => number } {
  let loads = 0;
  return {
    document: {
      document_id: extra.id ?? `doc-${name}`,
      document_name: name,
      mime_type: mime,
      file_id: `file-${name}`,
      file_size: extra.fileSize === undefined ? bytes.length : extra.fileSize,
      updated_at: extra.updated_at ?? '2026-01-01T00:00:00.000Z',
    },
    loadBytes: async () => {
      loads += 1;
      return extra.loadBytes ? extra.loadBytes() : bytes;
    },
    loadInAppMarkdown: async () => null,
    loads: () => loads,
  };
}

export function inAppSource(name: string, markdown: string | null): AttachmentSource {
  return {
    document: { document_id: `doc-${name}`, document_name: name, mime_type: null, file_id: null, file_size: null, updated_at: '2026-01-01T00:00:00.000Z' },
    loadBytes: async () => {
      throw new Error('in-app documents have no bytes');
    },
    loadInAppMarkdown: async () => markdown,
  };
}

/** A stand-in for the Ghostscript renderer: returns a plain PNG per requested page. */
export async function fakeRenderer(png: () => Promise<Buffer>, calls: number[][] = []) {
  return async (_pdf: Buffer, pages: readonly number[]) => {
    calls.push([...pages]);
    return Promise.all(pages.map(() => png()));
  };
}
