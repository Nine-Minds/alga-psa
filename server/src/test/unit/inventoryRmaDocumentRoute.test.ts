import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ download: vi.fn() }));

vi.mock('@alga-psa/billing/actions', () => ({ downloadRmaReturnSlipPDF: mocks.download }));
vi.mock('@alga-psa/auth', () => {
  class AuthenticationError extends Error {}
  return { AuthenticationError };
});

import { AuthenticationError } from '@alga-psa/auth';
import { GET } from '../../app/api/inventory/rma/[id]/document/route';

const ID = '11111111-1111-4111-8111-111111111111';
const call = (query = '?type=return-slip') =>
  GET(new Request(`http://localhost/api/inventory/rma/${ID}/document${query}`), { params: Promise.resolve({ id: ID }) });

describe('GET /api/inventory/rma/[id]/document', () => {
  beforeEach(() => mocks.download.mockReset());

  it('returns the return slip PDF as an attachment, never cached', async () => {
    mocks.download.mockResolvedValue({ pdfData: [37, 80, 68, 70], rmaNumber: 'RMA-00007' });
    const res = await call();
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('application/pdf');
    expect(res.headers.get('Content-Disposition')).toBe('attachment; filename="RMA-00007-return-slip.pdf"');
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(Buffer.from(await res.arrayBuffer()).toString()).toBe('%PDF');
    expect(mocks.download).toHaveBeenCalledWith(ID);
  });

  it('defaults to the return slip when no type is given and rejects other types', async () => {
    mocks.download.mockResolvedValue({ pdfData: [1], rmaNumber: 'RMA-1' });
    expect((await call('')).status).toBe(200);
    expect((await call('?type=other')).status).toBe(400);
  });

  it('answers a missing, unreadable and permission-denied RMA with the same 404 body', async () => {
    mocks.download.mockResolvedValueOnce({ actionError: 'RMA not found' });
    const missing = await call();
    mocks.download.mockResolvedValueOnce({ permissionError: 'Permission denied: nope' });
    const denied = await call();
    expect(missing.status).toBe(404);
    expect(denied.status).toBe(404);
    expect(await denied.text()).toBe(await missing.text());
  });

  it('maps unauthenticated to 401 and unexpected failures to 500 without leaking the cause', async () => {
    mocks.download.mockRejectedValueOnce(new AuthenticationError('no session'));
    expect((await call()).status).toBe(401);
    mocks.download.mockRejectedValueOnce(new Error('puppeteer exploded at /srv/x'));
    const res = await call();
    expect(res.status).toBe(500);
    expect(await res.text()).not.toContain('puppeteer');
  });
});
