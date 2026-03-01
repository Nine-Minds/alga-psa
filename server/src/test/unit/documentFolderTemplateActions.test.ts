import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createFolderTemplate, getFolderTemplate, getFolderTemplates } from '@alga-psa/documents/actions/folderTemplateActions';
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

function createCreateTemplateMocks() {
  const templateRecord = {
    template_id: 'tpl-100',
    tenant: 'tenant-123',
    name: 'Client Default',
    entity_type: 'client',
    is_default: true,
    created_at: new Date(),
    updated_at: new Date(),
    created_by: 'user-123',
    updated_by: 'user-123',
  };

  const insertedItems = [
    {
      template_item_id: 'item-1',
      tenant: 'tenant-123',
      template_id: 'tpl-100',
      parent_template_item_id: null,
      folder_name: 'Contracts',
      folder_path: '/Contracts',
      sort_order: 0,
      is_client_visible: true,
      created_at: new Date(),
      updated_at: new Date(),
      created_by: 'user-123',
      updated_by: 'user-123',
    },
    {
      template_item_id: 'item-2',
      tenant: 'tenant-123',
      template_id: 'tpl-100',
      parent_template_item_id: 'item-1',
      folder_name: 'SLAs',
      folder_path: '/Contracts/SLAs',
      sort_order: 1,
      is_client_visible: false,
      created_at: new Date(),
      updated_at: new Date(),
      created_by: 'user-123',
      updated_by: 'user-123',
    },
  ];

  const updateDefaultsBuilder: any = {
    where: vi.fn().mockReturnThis(),
    andWhere: vi.fn().mockReturnThis(),
    update: vi.fn().mockResolvedValue(1),
  };

  const templateInsertReturningBuilder: any = {
    returning: vi.fn().mockResolvedValue([templateRecord]),
  };

  const templateInsertBuilder: any = {
    insert: vi.fn().mockReturnValue(templateInsertReturningBuilder),
  };

  const templateBuilders = [updateDefaultsBuilder, templateInsertBuilder];

  const itemsInsertBuilder: any = {
    insert: vi.fn().mockResolvedValue(undefined),
  };

  const itemsSelectBuilder: any = {
    where: vi.fn().mockReturnThis(),
    andWhere: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockResolvedValue(insertedItems),
  };

  const itemBuilders = [itemsInsertBuilder, itemsSelectBuilder];

  const trx: any = vi.fn((tableName: string) => {
    if (tableName === 'document_folder_templates') {
      const nextBuilder = templateBuilders.shift();
      if (!nextBuilder) {
        throw new Error('Unexpected extra template table call');
      }

      return nextBuilder;
    }

    if (tableName === 'document_folder_template_items') {
      const nextBuilder = itemBuilders.shift();
      if (!nextBuilder) {
        throw new Error('Unexpected extra item table call');
      }

      return nextBuilder;
    }

    throw new Error(`Unexpected table: ${tableName}`);
  });

  const knexFn: any = vi.fn();
  knexFn.transaction = vi.fn(async (callback: any) => callback(trx));

  return {
    knexFn,
    trx,
    updateDefaultsBuilder,
    templateInsertBuilder,
    templateInsertReturningBuilder,
    itemsInsertBuilder,
    itemsSelectBuilder,
    templateRecord,
    insertedItems,
  };
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

  it('creates a folder template with items and unsets previous defaults for entity type', async () => {
    const createMocks = createCreateTemplateMocks();

    vi.mocked(createTenantKnex).mockResolvedValue({
      knex: createMocks.knexFn,
      tenant: mockUser.tenant,
    });

    const result = await createFolderTemplate({
      name: ' Client Default ',
      entityType: 'CLIENT',
      isDefault: true,
      items: [
        {
          folderPath: '/Contracts',
          sortOrder: 0,
          isClientVisible: true,
        },
        {
          folderPath: '/Contracts/SLAs',
          sortOrder: 1,
        },
      ],
    });

    expect(result).toEqual({
      ...createMocks.templateRecord,
      items: createMocks.insertedItems,
    });

    expect(createMocks.knexFn.transaction).toHaveBeenCalledTimes(1);
    expect(createMocks.updateDefaultsBuilder.where).toHaveBeenCalledWith('tenant', mockUser.tenant);
    expect(createMocks.updateDefaultsBuilder.andWhere).toHaveBeenCalledWith('entity_type', 'client');
    expect(createMocks.updateDefaultsBuilder.update).toHaveBeenCalledWith(
      expect.objectContaining({
        is_default: false,
        updated_by: mockUser.user_id,
      })
    );

    expect(createMocks.templateInsertBuilder.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        tenant: mockUser.tenant,
        name: 'Client Default',
        entity_type: 'client',
        is_default: true,
        created_by: mockUser.user_id,
        updated_by: mockUser.user_id,
      })
    );

    const insertedItemRows = createMocks.itemsInsertBuilder.insert.mock.calls[0][0];
    expect(insertedItemRows).toHaveLength(2);

    const parentRow = insertedItemRows.find((row: any) => row.folder_path === '/Contracts');
    const childRow = insertedItemRows.find((row: any) => row.folder_path === '/Contracts/SLAs');

    expect(parentRow.parent_template_item_id).toBeNull();
    expect(childRow.parent_template_item_id).toEqual(parentRow.template_item_id);
    expect(parentRow.folder_name).toBe('Contracts');
    expect(childRow.folder_name).toBe('SLAs');
    expect(parentRow.is_client_visible).toBe(true);
    expect(childRow.is_client_visible).toBe(false);
  });

  it('requires document create permission for createFolderTemplate', async () => {
    vi.mocked(hasPermission).mockResolvedValue(false);

    await expect(
      createFolderTemplate({
        name: 'Client Default',
        entityType: 'client',
        items: [],
      })
    ).resolves.toEqual({ permissionError: 'Permission denied' });
  });

  it('throws when template items contain duplicate folder paths', async () => {
    await expect(
      createFolderTemplate({
        name: 'Client Default',
        entityType: 'client',
        items: [
          { folderPath: '/Contracts' },
          { folderPath: '/Contracts' },
        ],
      })
    ).rejects.toThrow('Duplicate template item folderPath: /Contracts');
  });
});
