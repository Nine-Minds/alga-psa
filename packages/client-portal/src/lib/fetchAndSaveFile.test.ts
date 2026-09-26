/** @vitest-environment jsdom */
import { describe, expect, it, vi, afterEach } from 'vitest';
import { DocumentRequestError, fetchAndSaveFile } from './fetchAndSaveFile';

describe('fetchAndSaveFile', () => {
  afterEach(() => vi.restoreAllMocks());
  it('rejects API errors instead of downloading their bodies', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: 'Missing', code: 'no_file' }), { status: 404 })));
    await expect(fetchAndSaveFile('/file', 'fallback')).rejects.toMatchObject({ status: 404, code: 'no_file' });
  });
  it('uses the Content-Disposition filename for successful bytes', async () => {
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(new Uint8Array([37, 80, 68, 70]), { headers: { 'Content-Disposition': "attachment; filename*=UTF-8''meeting%20notes.pdf" } })));
    await fetchAndSaveFile('/file', 'fallback');
    expect(click).toHaveBeenCalledOnce();
  });
});
