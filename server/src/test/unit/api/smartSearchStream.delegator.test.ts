import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const eePostMock = vi.hoisted(() => vi.fn());

vi.mock('@enterprise/app/api/smart-search/[entity]/stream/route', () => ({
  POST: eePostMock,
}));

const makeRequest = () =>
  new Request('http://example.com/api/smart-search/project/stream', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ scope: { projectIds: [] }, query: 'q' }),
  });

const context = { params: Promise.resolve({ entity: 'project' }) };

describe('POST /api/smart-search/[entity]/stream (edition delegator)', () => {
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

  const load = async () => (await import('@/app/api/smart-search/[entity]/stream/route')).POST;

  it('answers 404 in community edition without loading enterprise code', async () => {
    process.env.EDITION = 'ce';
    const POST = await load();
    const response = await POST(makeRequest(), context);
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ code: 'ENTERPRISE_EDITION_REQUIRED' });
    expect(eePostMock).not.toHaveBeenCalled();
  });

  it('hands the request and its entity to the enterprise handler in enterprise edition', async () => {
    process.env.EDITION = 'ee';
    eePostMock.mockResolvedValue(new Response('ok', { status: 200 }));
    const POST = await load();
    const request = makeRequest();
    const response = await POST(request, context);
    expect(response.status).toBe(200);
    expect(eePostMock).toHaveBeenCalledWith(request, context);
  });
});
