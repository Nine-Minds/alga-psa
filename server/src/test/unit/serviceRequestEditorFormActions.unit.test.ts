import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  createTenantKnexMock,
  addBasicFormFieldToDefinitionDraftMock,
  updateBasicFormFieldInDefinitionDraftMock,
  removeBasicFormFieldFromDefinitionDraftMock,
  reorderBasicFormFieldsInDefinitionDraftMock,
  saveServiceRequestDefinitionDraftMock,
} = vi.hoisted(() => ({
  createTenantKnexMock: vi.fn(),
  addBasicFormFieldToDefinitionDraftMock: vi.fn(),
  updateBasicFormFieldInDefinitionDraftMock: vi.fn(),
  removeBasicFormFieldFromDefinitionDraftMock: vi.fn(),
  reorderBasicFormFieldsInDefinitionDraftMock: vi.fn(),
  saveServiceRequestDefinitionDraftMock: vi.fn(),
}));

vi.mock('@alga-psa/db', async () => {
  const actual = await vi.importActual<typeof import('@alga-psa/db')>('@alga-psa/db');
  return {
    ...actual,
    createTenantKnex: createTenantKnexMock,
  };
});

vi.mock('../../lib/service-requests', async () => {
  const actual = await vi.importActual<typeof import('../../lib/service-requests')>(
    '../../lib/service-requests'
  );
  return {
    ...actual,
    addBasicFormFieldToDefinitionDraft: addBasicFormFieldToDefinitionDraftMock,
    updateBasicFormFieldInDefinitionDraft: updateBasicFormFieldInDefinitionDraftMock,
    removeBasicFormFieldFromDefinitionDraft: removeBasicFormFieldFromDefinitionDraftMock,
    reorderBasicFormFieldsInDefinitionDraft: reorderBasicFormFieldsInDefinitionDraftMock,
    saveServiceRequestDefinitionDraft: saveServiceRequestDefinitionDraftMock,
  };
});

import { getCurrentUser, hasPermission } from '@alga-psa/auth';
import {
  addServiceRequestFormFieldAction,
  updateServiceRequestExecutionConfigAction,
  updateServiceRequestFormFieldAction,
  removeServiceRequestFormFieldAction,
  reorderServiceRequestFormFieldsAction,
} from '../../app/msp/service-requests/actions';

describe('service request editor form actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createTenantKnexMock.mockResolvedValue({ knex: { mocked: true } });
    vi.mocked(getCurrentUser).mockResolvedValue({
      user_id: '00000000-0000-0000-0000-000000000123',
      tenant: '00000000-0000-0000-0000-000000000999',
      user_type: 'internal',
      roles: [],
    } as any);
    vi.mocked(hasPermission).mockResolvedValue(true);

    addBasicFormFieldToDefinitionDraftMock.mockResolvedValue({ definition_id: 'definition-1' });
    updateBasicFormFieldInDefinitionDraftMock.mockResolvedValue({ definition_id: 'definition-1' });
    removeBasicFormFieldFromDefinitionDraftMock.mockResolvedValue({ definition_id: 'definition-1' });
    reorderBasicFormFieldsInDefinitionDraftMock.mockResolvedValue({ definition_id: 'definition-1' });
    saveServiceRequestDefinitionDraftMock.mockResolvedValue({ definition_id: 'definition-1' });
  });

  it('wires add/update/remove/reorder form authoring actions through basic form builder helpers', async () => {
    await addServiceRequestFormFieldAction('definition-1', 'short-text');
    await updateServiceRequestFormFieldAction('definition-1', 'new_short_text_field', {
      label: 'Employee Name',
      required: true,
      helpText: 'Enter full name',
    });
    await removeServiceRequestFormFieldAction('definition-1', 'new_short_text_field');
    await reorderServiceRequestFormFieldsAction('definition-1', [
      'request_title',
      'requested_date',
      'manager_approval',
    ]);

    expect(addBasicFormFieldToDefinitionDraftMock).toHaveBeenCalledWith(
      expect.objectContaining({
        tenant: '00000000-0000-0000-0000-000000000999',
        definitionId: 'definition-1',
        field: expect.objectContaining({ type: 'short-text' }),
      })
    );

    expect(updateBasicFormFieldInDefinitionDraftMock).toHaveBeenCalledWith(
      expect.objectContaining({
        tenant: '00000000-0000-0000-0000-000000000999',
        definitionId: 'definition-1',
        fieldKey: 'new_short_text_field',
        updates: expect.objectContaining({
          label: 'Employee Name',
          required: true,
          helpText: 'Enter full name',
        }),
      })
    );

    expect(removeBasicFormFieldFromDefinitionDraftMock).toHaveBeenCalledWith(
      expect.objectContaining({
        tenant: '00000000-0000-0000-0000-000000000999',
        definitionId: 'definition-1',
        fieldKey: 'new_short_text_field',
      })
    );

    expect(reorderBasicFormFieldsInDefinitionDraftMock).toHaveBeenCalledWith(
      expect.objectContaining({
        tenant: '00000000-0000-0000-0000-000000000999',
        definitionId: 'definition-1',
        orderedFieldKeys: ['request_title', 'requested_date', 'manager_approval'],
      })
    );
  });

  it('saves ticket-only routing config through execution config updates', async () => {
    await updateServiceRequestExecutionConfigAction('definition-1', {
      boardId: 'board-123',
      statusId: 'status-123',
      priorityId: 'priority-123',
      categoryId: 'category-123',
      subcategoryId: 'subcategory-123',
      assignedToUserId: 'user-123',
      titleFieldKey: 'request_title',
      descriptionPrefix: 'Portal Service Request',
    });

    expect(saveServiceRequestDefinitionDraftMock).toHaveBeenCalledWith(
      expect.objectContaining({
        tenant: '00000000-0000-0000-0000-000000000999',
        definitionId: 'definition-1',
        updates: {
          execution_config: {
            boardId: 'board-123',
            statusId: 'status-123',
            priorityId: 'priority-123',
            categoryId: 'category-123',
            subcategoryId: 'subcategory-123',
            assignedToUserId: 'user-123',
            titleFieldKey: 'request_title',
            descriptionPrefix: 'Portal Service Request',
          },
        },
      })
    );
  });
});
