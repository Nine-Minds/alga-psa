import { describe, expect, it, vi } from 'vitest';

vi.mock('@alga-psa/clients/actions', () => ({}));
vi.mock('@alga-psa/integrations/actions', () => ({}));
vi.mock('@alga-psa/user-composition/actions', () => ({}));
vi.mock('@alga-psa/teams/actions', () => ({}));
vi.mock('@alga-psa/tickets/actions/ticketActions', () => ({}));
vi.mock('@alga-psa/auth/actions', () => ({}));
vi.mock('@alga-psa/projects/actions/projectActions', () => ({}));
vi.mock('@alga-psa/projects/actions/projectTaskActions', () => ({}));
vi.mock('../workflowPickerServerActions', () => ({}));
vi.mock('../workflowTicketPickerSearch', () => ({}));
vi.mock('@alga-psa/ui/components/ClientPicker', () => ({ ClientPicker: () => null }));
vi.mock('@alga-psa/ui/components/ContactPicker', () => ({ ContactPicker: () => null }));
vi.mock('@alga-psa/ui/components/UserPicker', () => ({ default: () => null }));
vi.mock('@alga-psa/ui/components/UserAndTeamPicker', () => ({ default: () => null }));
vi.mock('@alga-psa/ui/components/MultiUserAndTeamPicker', () => ({ default: () => null }));
vi.mock('@alga-psa/ui/components/settings/general/BoardPicker', () => ({ BoardPicker: () => null }));

import { mapWorkflowPickerOptions } from '../WorkflowActionInputFixedPicker';
import { findAnyBoardStatusName, statusIdsForName } from '../workflowStatusGroups';

const statuses = [
  { id: 's1', name: 'Awaiting Wisdom', board_id: 'b1', board_name: 'Urgent Matters' },
  { id: 's2', name: 'Awaiting Wisdom', board_id: 'b2', board_name: 'Support' },
  { id: 's3', name: 'Closed', board_id: 'b1', board_name: 'Urgent Matters' },
];
const data = (list: typeof statuses | Array<{ id: string; name: string }>) =>
  ({ ticketOptions: { statuses: list } } as unknown as Parameters<typeof mapWorkflowPickerOptions>[1]);

describe('ticket-status option labels', () => {
  it('gives same-named statuses on different boards distinct labels with the board', () => {
    const labels = mapWorkflowPickerOptions('ticket-status', data(statuses)).map((option) => option.label);
    expect(labels).toEqual(['Awaiting Wisdom · Urgent Matters', 'Awaiting Wisdom · Support', 'Closed · Urgent Matters']);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it('drops the board when the list is already scoped to one board (no board_name)', () => {
    const labels = mapWorkflowPickerOptions('ticket-status', data([{ id: 's1', name: 'Open' }])).map((option) => option.label);
    expect(labels).toEqual(['Open']);
  });

  it('offers "(any board)" first for a shared name, only when asked', () => {
    const options = mapWorkflowPickerOptions('ticket-status', data(statuses), undefined, { includeAnyBoardStatus: true });
    expect(options.map((option) => option.label)).toEqual([
      'Awaiting Wisdom (any board)',
      'Awaiting Wisdom · Urgent Matters',
      'Awaiting Wisdom · Support',
      'Closed · Urgent Matters',
    ]);
    expect(options[0].value).toBe('any-board-status:Awaiting Wisdom');
  });
});

describe('status groups', () => {
  it('matches a list only when it is exactly every id for one shared name', () => {
    expect(findAnyBoardStatusName(statuses, ['s2', 's1'])).toBe('Awaiting Wisdom');
    expect(findAnyBoardStatusName(statuses, ['s1'])).toBeNull();
    expect(findAnyBoardStatusName(statuses, ['s1', 's3'])).toBeNull();
    expect(statusIdsForName(statuses, 'Closed')).toEqual([]);
  });
});
