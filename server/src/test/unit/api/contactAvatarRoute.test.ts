import { describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('next/server', async () => ({
  ...await import('next/dist/server/web/spec-extension/request'),
  ...await import('next/dist/server/web/spec-extension/response'),
}));

vi.mock('../../../lib/db', () => ({
  runWithTenant: (_tenant: string, callback: () => Promise<unknown>) => callback(),
}));

import { ApiContactController } from '../../../lib/api/controllers/ApiContactController';
import type { AuthenticatedApiRequest } from '../../../lib/api/controllers/ApiBaseController';

const contactId = '00000000-0000-4000-8000-000000000001';

class AvatarController extends ApiContactController {
  constructor(contactService: Record<string, unknown>) {
    super();
    (this as any).contactService = contactService;
  }

  protected async authenticate(req: NextRequest) {
    return Object.assign(req, { context: { tenant: 'test-tenant', userId: 'user-1' }, params: Promise.resolve({ id: contactId }) }) as AuthenticatedApiRequest;
  }

  protected async checkPermission() {}
}

describe('/api/v1/contacts/{id}/avatar', () => {
  it('uploads the multipart avatar field', async () => {
    const uploadAvatar = vi.fn().mockResolvedValue({ success: true, message: 'Avatar uploaded successfully', avatarUrl: '/img/1' });
    const controller = new AvatarController({ uploadAvatar });
    const form = new FormData();
    form.append('avatar', new File([new Uint8Array([1, 2, 3])], 'me.png', { type: 'image/png' }));

    const response = await controller.uploadAvatar()(new NextRequest(`http://localhost/api/v1/contacts/${contactId}/avatar`, { method: 'POST', body: form }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ data: { success: true, message: 'Avatar uploaded successfully', avatarUrl: '/img/1' } });
    expect(uploadAvatar).toHaveBeenCalledWith(contactId, expect.any(File), expect.objectContaining({ tenant: 'test-tenant' }));
  });

  it('rejects a request without a file', async () => {
    const uploadAvatar = vi.fn();
    const controller = new AvatarController({ uploadAvatar });
    const form = new FormData();

    const response = await controller.uploadAvatar()(new NextRequest(`http://localhost/api/v1/contacts/${contactId}/avatar`, { method: 'POST', body: form }));

    expect(response.status).toBe(400);
    expect(uploadAvatar).not.toHaveBeenCalled();
  });

  it('deletes the avatar', async () => {
    const deleteAvatar = vi.fn().mockResolvedValue({ success: true, message: 'Avatar deleted successfully' });
    const controller = new AvatarController({ deleteAvatar });

    const response = await controller.deleteAvatar()(new NextRequest(`http://localhost/api/v1/contacts/${contactId}/avatar`, { method: 'DELETE' }));

    expect(response.status).toBe(200);
    expect(deleteAvatar).toHaveBeenCalledWith(contactId, expect.objectContaining({ tenant: 'test-tenant' }));
  });
});
