import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const eePostMock = vi.hoisted(() => vi.fn());

vi.mock('@enterprise/app/api/tickets/smart-search/stream/route', () => ({
  POST: eePostMock,
}));

const makeRequest = () =>
  new Request('http://example.com/api/tickets/smart-search/stream', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ filters: { boardFilterState: 'active' }, query: 'q' }),
  });

describe('POST /api/tickets/smart-search/stream (edition delegator)', () => {
  const originalEdition = process.env.EDITION;
  const originalPublicEdition = process.env.NEXT_PUBLIC_EDITION;

  beforeEach(() => {
    vi.resetModules();
    eePostMock.mockReset();
    delete process.env.NEXT_PUBLIC_EDITION;
  });

  afterEach(() => {
    if (originalEdition === undefined) delete process.env.EDITION;
    else process.env.EDITION = originalEdition;
    if (originalPublicEdition === undefined) delete process.env.NEXT_PUBLIC_EDITION;
    else process.env.NEXT_PUBLIC_EDITION = originalPublicEdition;
  });

  const load = async () => (await import('@/app/api/tickets/smart-search/stream/route')).POST;

  it('answers 404 in community edition without loading enterprise code', async () => {
    process.env.EDITION = 'ce';
    const POST = await load();
    const response = await POST(makeRequest());
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ code: 'ENTERPRISE_EDITION_REQUIRED' });
    expect(eePostMock).not.toHaveBeenCalled();
  });

  it('hands the request to the enterprise handler in enterprise edition', async () => {
    process.env.EDITION = 'ee';
    eePostMock.mockResolvedValue(new Response('ok', { status: 200 }));
    const POST = await load();
    const request = makeRequest();
    const response = await POST(request);
    expect(response.status).toBe(200);
    expect(eePostMock).toHaveBeenCalledWith(request);
  });
});
