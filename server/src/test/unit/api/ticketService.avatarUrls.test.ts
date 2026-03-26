import { describe, expect, it, vi, beforeEach } from 'vitest';
import { TicketService } from '../../../lib/api/services/TicketService';

const { getContactAvatarUrl, getClientLogoUrl } = vi.hoisted(() => ({
  getContactAvatarUrl: vi.fn(),
  getClientLogoUrl: vi.fn(),
}));

vi.mock('@alga-psa/formatting/avatarUtils', async () => {
  const actual = await vi.importActual<typeof import('@alga-psa/formatting/avatarUtils')>('@alga-psa/formatting/avatarUtils');
  return {
    ...actual,
    getContactAvatarUrl,
    getClientLogoUrl,
  };
});

function createQueryChain(ticket: Record<string, unknown> | null) {
  const chain = {
    leftJoin: vi.fn(() => chain),
    modify: vi.fn((callback: (builder: typeof chain) => void) => {
      callback(chain);
      return chain;
    }),
    select: vi.fn(() => chain),
    where: vi.fn(() => chain),
    first: vi.fn().mockResolvedValue(ticket),
  };

  return chain;
}

function createKnex(chain: ReturnType<typeof createQueryChain>) {
  return Object.assign(vi.fn(() => chain), {
    raw: vi.fn((value: string) => value),
  });
}

describe('TicketService avatar enrichment', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('T001/T002: includes contact and client image URLs when the ticket has both entities', async () => {
    const service = new TicketService();
    const query = createQueryChain({
      ticket_id: '123e4567-e89b-12d3-a456-426614174000',
      tenant: 'tenant-1',
      ticket_number: 'T-1',
      title: 'Example',
      client_id: 'client-1',
      contact_name_id: 'contact-1',
      attributes: null,
    });
    const knex = createKnex(query);

    vi.spyOn(service as any, 'getKnex').mockResolvedValue({ knex });
    vi.spyOn(service as any, 'getTicketDocuments').mockResolvedValue([]);
    getContactAvatarUrl.mockResolvedValue('/api/documents/view/contact-file?t=1');
    getClientLogoUrl.mockResolvedValue('/api/documents/view/client-file?t=2');

    const result = await service.getById('123e4567-e89b-12d3-a456-426614174000', {
      tenant: 'tenant-1',
      userId: 'user-1',
    } as any);

    expect(getContactAvatarUrl).toHaveBeenCalledWith('contact-1', 'tenant-1');
    expect(getClientLogoUrl).toHaveBeenCalledWith('client-1', 'tenant-1');
    expect(result).toMatchObject({
      contact_avatar_url: '/api/documents/view/contact-file?t=1',
      client_logo_url: '/api/documents/view/client-file?t=2',
    });
  });

  it('T003/T004: returns null URLs when image helpers return null', async () => {
    const service = new TicketService();
    const query = createQueryChain({
      ticket_id: '123e4567-e89b-12d3-a456-426614174000',
      tenant: 'tenant-1',
      ticket_number: 'T-1',
      title: 'Example',
      client_id: 'client-1',
      contact_name_id: 'contact-1',
      attributes: null,
    });
    const knex = createKnex(query);

    vi.spyOn(service as any, 'getKnex').mockResolvedValue({ knex });
    vi.spyOn(service as any, 'getTicketDocuments').mockResolvedValue([]);
    getContactAvatarUrl.mockResolvedValue(null);
    getClientLogoUrl.mockResolvedValue(null);

    const result = await service.getById('123e4567-e89b-12d3-a456-426614174000', {
      tenant: 'tenant-1',
      userId: 'user-1',
    } as any);

    expect(result).toMatchObject({
      contact_avatar_url: null,
      client_logo_url: null,
    });
  });

  it('T005: skips image lookups when the ticket has no contact or client', async () => {
    const service = new TicketService();
    const query = createQueryChain({
      ticket_id: '123e4567-e89b-12d3-a456-426614174000',
      tenant: 'tenant-1',
      ticket_number: 'T-1',
      title: 'Example',
      client_id: null,
      contact_name_id: null,
      attributes: null,
    });
    const knex = createKnex(query);

    vi.spyOn(service as any, 'getKnex').mockResolvedValue({ knex });
    vi.spyOn(service as any, 'getTicketDocuments').mockResolvedValue([]);

    const result = await service.getById('123e4567-e89b-12d3-a456-426614174000', {
      tenant: 'tenant-1',
      userId: 'user-1',
    } as any);

    expect(getContactAvatarUrl).not.toHaveBeenCalled();
    expect(getClientLogoUrl).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      contact_avatar_url: null,
      client_logo_url: null,
    });
  });
});
