/** @vitest-environment jsdom */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { fetchAndSaveFile } from './fetchAndSaveFile';

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
    expect(new Uint8Array(await downloadedBlob.arrayBuffer())).toEqual(new Uint8Array([37, 80, 68, 70]));
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:test');
    expect(document.body.contains(clickedAnchor)).toBe(false);
  });
});
