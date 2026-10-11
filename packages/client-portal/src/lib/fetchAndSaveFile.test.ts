/** @vitest-environment jsdom */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { fetchAndSaveFile } from './fetchAndSaveFile';

// Depending on module load order, `fetch`/`Response` (Node's undici) can hand
// back either Node's own Blob (has arrayBuffer()) or jsdom's Blob (no
// arrayBuffer(), but readable via FileReader). Detect capability at runtime
// instead of assuming a fixed realm, so this doesn't flake with test order.
const readBlob = (blob: Blob): Promise<Uint8Array> => {
  if (typeof (blob as { arrayBuffer?: () => Promise<ArrayBuffer> }).arrayBuffer === 'function') {
    return blob.arrayBuffer().then((buffer) => new Uint8Array(buffer));
  }
  return new Promise<Uint8Array>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(blob);
  });
};

describe('fetchAndSaveFile', () => {
  beforeEach(() => {
    // jsdom has no blob URL API. Preserve URL parsing and restore the global after each test.
    vi.stubGlobal('URL', class extends URL {
      static createObjectURL = vi.fn(() => 'blob:test');
      static revokeObjectURL = vi.fn();
    });
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });
  it('rejects API errors instead of downloading their bodies', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: 'Missing', code: 'no_file' }), { status: 404 })));
    await expect(fetchAndSaveFile('/file', 'fallback')).rejects.toMatchObject({ status: 404, code: 'no_file' });
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });
  it('uses the Content-Disposition filename for successful bytes', async () => {
    let clickedAnchor: HTMLAnchorElement | null = null;
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) { clickedAnchor = this; });
    vi.mocked(URL.createObjectURL).mockReturnValue('blob:test');
    vi.mocked(URL.revokeObjectURL).mockImplementation(() => {});
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(new Uint8Array([37, 80, 68, 70]), { headers: { 'Content-Disposition': "attachment; filename*=UTF-8''meeting%20notes.pdf" } })));
    await fetchAndSaveFile('/file', 'fallback');
    expect(click).toHaveBeenCalledOnce();
    expect(clickedAnchor?.download).toBe('meeting notes.pdf');
    expect(clickedAnchor?.href).toBe('blob:test');
    const downloadedBlob = vi.mocked(URL.createObjectURL).mock.calls[0][0] as Blob;
    expect(await readBlob(downloadedBlob)).toEqual(new Uint8Array([37, 80, 68, 70]));
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:test');
    expect(document.body.contains(clickedAnchor)).toBe(false);
  });
});
