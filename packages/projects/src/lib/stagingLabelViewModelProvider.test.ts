import { describe, expect, it, vi } from 'vitest';

vi.mock('@alga-psa/auth/rbac', () => ({ hasPermission: vi.fn() }));
vi.mock('@alga-psa/db', () => ({ createTenantKnex: vi.fn() }));
vi.mock('@alga-psa/inventory/lib/stagingContainers', () => ({ getContainers: vi.fn() }));
vi.mock('./projectReadAuthorization', () => ({ createProjectReadAuthorizer: vi.fn() }));

import { stagingContainerLabelViewModel, stagingContainerOwnershipNote } from './stagingLabelViewModelProvider';

const member = (kind: 'stock' | 'client_asset' | 'client_item') => ({ kind }) as any;
const box = (kinds: Array<'stock' | 'client_asset' | 'client_item'>) =>
  ({
    container_id: 'box-1',
    project_id: 'p-1',
    identifier: 'PRJ-0042-B03',
    project_number: 'PRJ-0042',
    project_name: 'Office move',
    client_name: 'Acme',
    task_name: 'Rack and stack',
    name: null,
    position: { n: 3, total: 4 },
    members: kinds.map(member),
  }) as any;

describe('staging box label ownership summary (C6 follow-up D9)', () => {
  it('prints "Contains client-owned equipment (n)" counting client lines', () => {
    expect(stagingContainerOwnershipNote(box(['stock', 'client_asset', 'client_item', 'client_asset']))).toBe('Contains client-owned equipment (3)');
    expect(stagingContainerLabelViewModel(box(['client_asset']), 'https://psa.example').ownershipNote).toBe('Contains client-owned equipment (1)');
  });

  it('prints nothing new for an all-MSP or empty box', () => {
    expect(stagingContainerOwnershipNote(box(['stock', 'stock']))).toBeNull();
    expect(stagingContainerLabelViewModel(box([]), 'https://psa.example').ownershipNote).toBeNull();
  });
});
