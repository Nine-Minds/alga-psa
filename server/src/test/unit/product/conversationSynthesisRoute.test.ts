import { beforeEach, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
const mocks = vi.hoisted(() => ({ prepare: vi.fn() }));
vi.mock('@alga-psa/tickets/actions/conversationAiActions', () => ({ prepareNamedConversationSynthesisAction: mocks.prepare }));
import { POST } from '../../../app/api/tickets/conversation-synthesis/route';
const body = { ticket: { tenant: 'owner', ticketId: 'ticket' }, destination: { storeTenant: 'home', conversationId: 'conversation' }, request: { operationId: 'operation' } };
const request = (data: unknown = body, origin = 'https://psa.example.test') => new NextRequest('https://psa.example.test/api/tickets/conversation-synthesis', {
  method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify(data),
});
beforeEach(() => { vi.resetAllMocks(); });
it('calls the existing authenticated qualified command without accepting an actor from HTTP input', async () => {
  mocks.prepare.mockResolvedValue({ ok: true, result: { status: 'completed', sourceChanged: false, draft: { revision: 1 } } });
  const response = await POST(request());
  expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toBe('no-store');
  expect(await response.json()).toMatchObject({ ok: true, result: { status: 'completed' } });
  expect(mocks.prepare).toHaveBeenCalledWith(body.ticket, body.destination, body.request);
  expect((await POST(request({ ...body, actor: { tenant: 'borrowed-authority' } }))).status).toBe(400);
  expect(mocks.prepare).toHaveBeenCalledOnce();
});
it('rejects cross-origin and malformed requests before starting generation', async () => {
  expect((await POST(request(body, 'https://other.example.test'))).status).toBe(403);
  expect((await POST(request(null))).status).toBe(400);
  expect((await POST(new NextRequest('https://psa.example.test/api/tickets/conversation-synthesis', { method: 'POST', body: 'x' }))).status).toBe(403);
  expect(mocks.prepare).not.toHaveBeenCalled();
});
it('preserves controlled context errors and hides rejected authentication details', async () => {
  mocks.prepare.mockResolvedValueOnce({ ok: false, code: 'AI_CONTEXT_TOO_LARGE' }).mockRejectedValueOnce(new Error('Private session detail'));
  expect(await (await POST(request())).json()).toEqual({ ok: false, code: 'AI_CONTEXT_TOO_LARGE' });
  const response = await POST(request()); expect(response.status).toBe(403);
  expect(await response.json()).toEqual({ ok: false, code: 'unavailable' });
});

it('uses the deployment-aware public origin when Next normalizes the internal request URL', async () => {
  mocks.prepare.mockResolvedValue({ ok: true, result: { status: 'running' } });
  const response = await POST(new NextRequest('http://localhost:3000/api/tickets/conversation-synthesis', {
    method: 'POST', headers: { origin: 'https://psa.example.test', host: 'psa.example.test', 'x-forwarded-proto': 'https', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }));
  expect(response.status).toBe(200); expect(mocks.prepare).toHaveBeenCalledWith(body.ticket, body.destination, body.request);
});
