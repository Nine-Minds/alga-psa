import { describe, expect, it, vi } from 'vitest';
import { loadProjectRowsByDecision, projectPickerProjection } from './projectListProjection';
import { projectClientListsForPage, projectClientPresentation } from './projectClientPresentation';
import type { IProject } from '@alga-psa/types';

const row = (project_id: string, client_name: string | null = 'Acme') => ({ project_id, client_name }) as IProject;

describe('decision-aware project list projection', () => {
  it('excludes denied rows, groups mixed redactions, and restores identity order', async () => {
    const loadUnmasked = vi.fn(async (ids: string[]) => ids.map((id) => row(id)));
    const loadMasked = vi.fn(async (ids: string[], fields: string[]) => ids.map((id) => row(id, fields.includes('client_name') ? null : 'Acme')));
    const result = await loadProjectRowsByDecision({
      identities: ['p3', 'p1', 'p2', 'outside-tenant'].map((project_id) => ({ project_id })),
      decisions: [
        { project: { project_id: 'p1' }, allowed: true, redactedFields: ['description'] },
        { project: { project_id: 'p2' }, allowed: true, redactedFields: ['client_name'] },
        { project: { project_id: 'p3' }, allowed: true, redactedFields: [] },
        { project: { project_id: 'outside-tenant' }, allowed: false, redactedFields: [] },
      ],
      loadUnmasked,
      loadMasked,
    });

    expect(result.map((project) => project.project_id)).toEqual(['p3', 'p1', 'p2']);
    expect(loadUnmasked).toHaveBeenCalledExactlyOnceWith(['p3']);
    expect(loadMasked).toHaveBeenCalledTimes(2);
    expect(loadMasked).toHaveBeenCalledWith(['p1'], ['description']);
    expect(loadMasked).toHaveBeenCalledWith(['p2'], ['client_name']);
    expect(result.find((project) => project.project_id === 'p2')?.client_name).toBeNull();
  });

  it('unions caller redactions with kernel decisions and uses only a masked projection', async () => {
    const loadUnmasked = vi.fn(async () => [row('p1')]);
    const loadMasked = vi.fn(async (_ids: string[], fields: string[]) => [row('p1', fields.includes('client_name') ? null : 'Acme')]);
    const result = await loadProjectRowsByDecision({
      identities: [{ project_id: 'p1' }],
      decisions: [{ project: { project_id: 'p1' }, allowed: true, redactedFields: ['description'] }],
      callerRedactions: { p1: ['client_name'] },
      loadUnmasked,
      loadMasked,
    });
    expect(loadUnmasked).not.toHaveBeenCalled();
    expect(loadMasked).toHaveBeenCalledWith(['p1'], ['client_name', 'description']);
    expect(result[0].client_name).toBeNull();
  });
});

describe('project client presentation', () => {
  it('excludes denied clients and returns only picker fields with redactions applied', () => {
    const projected = projectPickerProjection([
      { client_id: 'c1', client_name: 'Acme', client_type: 'company' as const, is_inactive: false, billing_address: 'secret' },
      { client_id: 'c2', client_name: 'Hidden', client_type: 'individual' as const, is_inactive: true, billing_address: 'secret' },
    ], [
      { allowed: true, redactedFields: ['client_name', 'is_inactive'] },
      { allowed: false, redactedFields: [] },
    ]);
    expect(projected).toEqual([{ client_id: 'c1', client_name: null, client_type: 'company', is_inactive: null }]);
    expect(projected[0]).not.toHaveProperty('billing_address');
  });

  it('never rebuilds a hidden project name from a visible picker record', () => {
    expect(projectClientPresentation({ client_id: 'c1', client_name: null }, [
      { client_id: 'c1', client_name: 'Acme', logoUrl: '/logo.png' },
    ])).toEqual({ clientName: null, logoUrl: null, visibleClientId: null });
  });

  it('adds logo and summary metadata only when both names are visible', () => {
    expect(projectClientPresentation({ client_id: 'c1', client_name: 'Acme' }, [
      { client_id: 'c1', client_name: 'Acme', logoUrl: '/logo.png' },
    ])).toEqual({ clientName: 'Acme', logoUrl: '/logo.png', visibleClientId: 'c1' });
    expect(projectClientPresentation({ client_id: 'c1', client_name: 'Acme' }, [])).toEqual({
      clientName: 'Acme', logoUrl: null, visibleClientId: null,
    });
  });

  it('keeps authorized picker options available when there are no visible projects', () => {
    const authorizedPickerClients = [{ client_id: 'c1', client_name: 'Acme', client_type: 'company' as const, is_inactive: false }];
    expect(projectClientListsForPage([], authorizedPickerClients)).toEqual({
      pickerClients: authorizedPickerClients,
      tableMetadata: [],
    });
  });
});
