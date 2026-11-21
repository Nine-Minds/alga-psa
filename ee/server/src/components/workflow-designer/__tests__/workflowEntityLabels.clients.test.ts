import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  search: vi.fn(async (params: { ids?: string[] }) => ({
    clients: (params.ids ?? []).filter((id) => id === 'c-1').map((id) => ({ client_id: id, client_name: 'Acme' })),
    total: 1,
  })),
  options: vi.fn(async () => ({
    options: { boards: [{ id: 'b-1', name: 'Support' }], statuses: [], priorities: [], categories: [], users: [], locations: [] },
  })),
}));

vi.mock('@alga-psa/clients/actions/clientPickerActions', () => ({ searchClientsForPicker: mocks.search }));
vi.mock('@alga-psa/integrations/actions', () => ({ getTicketFieldOptions: mocks.options }));
vi.mock('@alga-psa/teams/actions', () => ({ getTeamsBasic: vi.fn(async () => []), isTeamActionError: () => false }));

import { loadWorkflowEntityLabels, resolveWorkflowClientNames } from '../workflowEntityLabels';

describe('workflow entity labels', () => {
  it('names other entities from the field options, and clients only by id', async () => {
    const { labels } = await loadWorkflowEntityLabels();
    expect(labels.get('b-1')).toBe('Support');
    expect(mocks.search).not.toHaveBeenCalled();

    const names = await resolveWorkflowClientNames(['c-1', 'c-1', 'x-9']);
    expect(names.get('c-1')).toBe('Acme');
    expect(mocks.search).toHaveBeenCalledTimes(1);
    expect(mocks.search).toHaveBeenCalledWith({ ids: ['c-1', 'x-9'], status: 'all' });

    await resolveWorkflowClientNames(['c-1']);
    expect(mocks.search).toHaveBeenCalledTimes(1);
  });
});
