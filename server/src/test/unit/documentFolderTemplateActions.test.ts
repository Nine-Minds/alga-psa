import { describe, it, expect, beforeEach, vi } from 'vitest';
import { getFolderTemplate, getFolderTemplates } from '@alga-psa/documents/actions/folderTemplateActions';
import type { IUser } from '@alga-psa/types';

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: vi.fn()
}));

vi.mock('@alga-psa/auth', () => {
  const getCurrentUser = vi.fn();
  const hasPermission = vi.fn();

  return {
    getCurrentUser,
    hasPermission,
    withAuth: (action: any) => async (...args: any[]) => {
      const user = await getCurrentUser();
      if (!user) {
        throw new Error('User not authenticated');
      }

      return action(user, { tenant: user.tenant }, ...args);
    }
  };
});

import { createTenantKnex } from '@alga-psa/db';
import { getCurrentUser, hasPermission } from '@alga-psa/auth';

function createMockKnex() {
  const queryBuilder: any = {
    where: vi.fn().mockReturnThis(),
    andWhere: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    orderBy: vi.fn(),
    first: vi.fn(),
  };

  const knexFn: any = vi.fn(() => queryBuilder);
  knexFn.queryBuilder = queryBuilder;

  return knexFn;
}

describe('document folder template actions', () => {
  const mockUser: IUser = {
    user_id: 'user-123',
    tenant: 'tenant-123',
    username: 'test-user',
    email: 'test@example.com',
    user_type: 'internal',
    hashed_password: '',
    first_name: 'Test',
    last_name: 'User',
    is_inactive: false,
  };

  let mockKnex: ReturnType<typeof createMockKnex>;

  beforeEach(() => {
    vi.clearAllMocks();

    vi.mocked(getCurrentUser).mockResolvedValue(mockUser);
    vi.mocked(hasPermission).mockResolvedValue(true);

    mockKnex = createMockKnex();
    mockKnex.queryBuilder.orderBy.mockResolvedValue([]);

    vi.mocked(createTenantKnex).mockResolvedValue({
      knex: mockKnex,
      tenant: mockUser.tenant,
    });
  });

  it('returns all templates for tenant when entityType is omitted', async () => {
    const templates = [
      {
        template_id: 'tpl-1',
        tenant: mockUser.tenant,
        name: 'Client Default',
        entity_type: 'client',
        is_default: true,
        created_at: new Date(),
        updated_at: new Date(),
        created_by: mockUser.user_id,
        updated_by: mockUser.user_id,
      },
    ];

    mockKnex.queryBuilder.orderBy.mockResolvedValue(templates);

    const result = await getFolderTemplates();

    expect(result).toEqual(templates);
    expect(mockKnex).toHaveBeenCalledWith('document_folder_templates');
    expect(mockKnex.queryBuilder.where).toHaveBeenCalledWith('tenant', mockUser.tenant);
    expect(mockKnex.queryBuilder.andWhere).not.toHaveBeenCalled();
    expect(mockKnex.queryBuilder.orderBy).toHaveBeenCalledWith([
      { column: 'entity_type', order: 'asc' },
      { column: 'is_default', order: 'desc' },
      { column: 'name', order: 'asc' },
    ]);
  });

  it('filters by entityType when provided', async () => {
    await getFolderTemplates('client');

    expect(mockKnex.queryBuilder.andWhere).toHaveBeenCalledWith('entity_type', 'client');
  });

  it('requires document read permission', async () => {
    vi.mocked(hasPermission).mockResolvedValue(false);

    await expect(getFolderTemplates()).resolves.toEqual({ permissionError: 'Permission denied' });
    expect(mockKnex).not.toHaveBeenCalled();
  });

  it('returns template with items when template exists', async () => {
    const template = {
      template_id: 'tpl-1',
      tenant: mockUser.tenant,
      name: 'Client Default',
      entity_type: 'client',
      is_default: true,
      created_at: new Date(),
      updated_at: new Date(),
      created_by: mockUser.user_id,
      updated_by: mockUser.user_id,
    };

    const items = [
      {
        template_item_id: 'item-1',
        tenant: mockUser.tenant,
        template_id: 'tpl-1',
        parent_template_item_id: null,
        folder_name: 'Contracts',
        folder_path: '/Contracts',
        sort_order: 0,
        is_client_visible: true,
        created_at: new Date(),
        updated_at: new Date(),
        created_by: mockUser.user_id,
        updated_by: mockUser.user_id,
      },
    ];

    const templateQueryBuilder: any = {
      where: vi.fn().mockReturnThis(),
      andWhere: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      first: vi.fn().mockResolvedValue(template),
    };

    const itemQueryBuilder: any = {
      where: vi.fn().mockReturnThis(),
      andWhere: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockResolvedValue(items),
    };

    mockKnex.mockImplementation((tableName: string) => {
      if (tableName === 'document_folder_templates') {
        return templateQueryBuilder;
      }

      if (tableName === 'document_folder_template_items') {
        return itemQueryBuilder;
      }

      return createMockKnex().queryBuilder;
    });

    const result = await getFolderTemplate('tpl-1');

    expect(result).toEqual({ ...template, items });
    expect(templateQueryBuilder.where).toHaveBeenCalledWith('tenant', mockUser.tenant);
    expect(templateQueryBuilder.andWhere).toHaveBeenCalledWith('template_id', 'tpl-1');
    expect(itemQueryBuilder.andWhere).toHaveBeenCalledWith('template_id', 'tpl-1');
    expect(itemQueryBuilder.orderBy).toHaveBeenCalledWith([
      { column: 'sort_order', order: 'asc' },
      { column: 'folder_path', order: 'asc' },
    ]);
  });

  it('returns null when template does not exist for tenant', async () => {
    const templateQueryBuilder: any = {
      where: vi.fn().mockReturnThis(),
      andWhere: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      first: vi.fn().mockResolvedValue(undefined),
    };

    mockKnex.mockImplementation((tableName: string) => {
      if (tableName === 'document_folder_templates') {
        return templateQueryBuilder;
      }

      throw new Error(`Unexpected table: ${tableName}`);
    });

    const result = await getFolderTemplate('missing-template');

    expect(result).toBeNull();
    expect(templateQueryBuilder.where).toHaveBeenCalledWith('tenant', mockUser.tenant);
    expect(templateQueryBuilder.andWhere).toHaveBeenCalledWith('template_id', 'missing-template');
  });

  it('requires non-empty templateId', async () => {
    await expect(getFolderTemplate('')).rejects.toThrow('templateId is required');
  });

  it('enforces document read permission for getFolderTemplate', async () => {
    vi.mocked(hasPermission).mockResolvedValue(false);

    await expect(getFolderTemplate('tpl-1')).resolves.toEqual({ permissionError: 'Permission denied' });
    expect(mockKnex).not.toHaveBeenCalled();
  });
});
