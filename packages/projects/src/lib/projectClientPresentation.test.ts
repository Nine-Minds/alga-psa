import { describe, expect, it } from 'vitest';
import { projectClientPresentation } from './projectClientPresentation';

describe('project client presentation', () => {
  const clients = [{ client_id: 'client-1', client_name: 'Real client', logoUrl: '/real-logo.png' }] as any[];

  it('does not rehydrate client name or logo from global options for a masked project', () => {
    expect(projectClientPresentation({ project_id: 'p1', client_id: 'client-1', client_name: null } as any, clients)).toBeNull();
  });

  it('keeps authorized unredacted client metadata available', () => {
    expect(projectClientPresentation({ project_id: 'p1', client_id: 'client-1', client_name: 'Real client' } as any, clients)).toEqual(clients[0]);
  });
});
