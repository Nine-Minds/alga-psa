// @vitest-environment node

import { describe, expect, it } from 'vitest';
import {
  buildTicketListHref,
  hasExplicitQualifiedScope,
  isQualifiedTicketListScope,
  parseTicketListPresentation,
  parseTicketListScope,
  resetQualifiedTicketListPresentation,
  serializeTicketListQuery,
  switchTicketListView,
  ticketListScopesEqual,
  ticketListWorkspaceToken,
  type QualifiedTicketListScope,
} from './ticketListScope';

const TENANT_A = '11111111-1111-4111-8111-111111111111';
const TENANT_B = '22222222-2222-4222-8222-222222222222';

describe('parseTicketListScope', () => {
  it('treats a bare list and native filter URLs as native', () => {
    expect(parseTicketListScope('')).toEqual({ kind: 'native' });
    expect(parseTicketListScope('?boardIds=abc&statusId=open&searchQuery=printer')).toEqual({ kind: 'native' });
  });

  it('treats a malformed queueView as native rather than a qualified scope', () => {
    expect(parseTicketListScope('?queueView=everything')).toEqual({ kind: 'native' });
    expect(parseTicketListScope('?queueView=')).toEqual({ kind: 'native' });
  });

  it('parses working/all and working/this-msp explicitly', () => {
    expect(parseTicketListScope('?queueView=working&workspace=all')).toEqual({
      kind: 'qualified',
      view: 'working',
      workspace: 'all',
    });
    expect(parseTicketListScope('?queueView=working&workspace=msp')).toEqual({
      kind: 'qualified',
      view: 'working',
      workspace: 'msp',
    });
  });

  it('parses an explicit customer workspace for oversight', () => {
    expect(parseTicketListScope(`?queueView=oversight&workspace=${TENANT_A}`)).toEqual({
      kind: 'qualified',
      view: 'oversight',
      workspace: { tenant: TENANT_A },
    });
  });

  it('normalizes This MSP out of oversight instead of carrying a scope that does not exist there', () => {
    expect(parseTicketListScope('?queueView=oversight&workspace=msp')).toEqual({
      kind: 'qualified',
      view: 'oversight',
      workspace: 'all',
    });
  });

  it('does not invent a workspace from a malformed token', () => {
    expect(parseTicketListScope('?queueView=working&workspace=not-a-tenant')).toEqual({
      kind: 'qualified',
      view: 'working',
      workspace: 'all',
    });
  });

  it('defaults a qualified view with no workspace to all authorized workspaces', () => {
    expect(parseTicketListScope('?queueView=working')).toEqual({
      kind: 'qualified',
      view: 'working',
      workspace: 'all',
    });
  });

  it('reports explicit qualified intent separately from native URLs', () => {
    expect(hasExplicitQualifiedScope('')).toBe(false);
    expect(hasExplicitQualifiedScope('?queueView=working&workspace=all')).toBe(true);
    expect(hasExplicitQualifiedScope('?queueView=bogus')).toBe(false);
  });
});

describe('serializeTicketListQuery / buildTicketListHref', () => {
  it('round-trips a qualified scope and non-default presentation', () => {
    const query = serializeTicketListQuery(
      { kind: 'qualified', view: 'oversight', workspace: { tenant: TENANT_A } },
      { searchQuery: 'vpn', page: 3, pageSize: 25, state: 'closed', sort: 'title', direction: 'asc' },
    );
    const params = new URLSearchParams(query);
    expect(params.get('queueView')).toBe('oversight');
    expect(params.get('workspace')).toBe(TENANT_A);
    expect(params.get('searchQuery')).toBe('vpn');
    expect(params.get('queueState')).toBe('closed');
    expect(params.get('queueSort')).toBe('title');
    expect(params.get('queueDirection')).toBe('asc');
    expect(params.get('page')).toBe('3');
    expect(params.get('pageSize')).toBe('25');
    expect(parseTicketListScope(query)).toEqual({
      kind: 'qualified',
      view: 'oversight',
      workspace: { tenant: TENANT_A },
    });
  });

  it('omits defaults and native scopes from the query', () => {
    expect(serializeTicketListQuery({ kind: 'native' })).toBe('');
    expect(serializeTicketListQuery(
      { kind: 'qualified', view: 'working', workspace: 'all' },
      { searchQuery: '', page: 1, pageSize: 10, state: 'open', sort: 'updated', direction: 'desc' },
    )).toBe('queueView=working&workspace=all');
  });

  it('builds an href without a dangling question mark for native', () => {
    expect(buildTicketListHref({ kind: 'native' })).toBe('/msp/tickets');
    expect(buildTicketListHref({ kind: 'qualified', view: 'working', workspace: 'all' }))
      .toBe('/msp/tickets?queueView=working&workspace=all');
  });

  it('carries clientId only when asked', () => {
    const scope: QualifiedTicketListScope = { kind: 'qualified', view: 'working', workspace: 'all' };
    expect(serializeTicketListQuery(scope, { clientId: TENANT_A }, { includeClient: true }))
      .toContain(`clientId=${TENANT_A}`);
    expect(serializeTicketListQuery(scope, { clientId: TENANT_A })).not.toContain('clientId');
  });
});

describe('parseTicketListPresentation', () => {
  it('normalizes page sizes into the supported 1..100 range', () => {
    expect(parseTicketListPresentation('?pageSize=0').pageSize).toBe(10);
    expect(parseTicketListPresentation('?pageSize=9999').pageSize).toBe(100);
    expect(parseTicketListPresentation('?pageSize=8').pageSize).toBe(8);
    expect(parseTicketListPresentation('?pageSize=abc').pageSize).toBe(10);
  });

  it('ignores unsupported qualified state/sort values', () => {
    const parsed = parseTicketListPresentation('?queueState=weird&queueSort=assignee&queueDirection=sideways');
    expect(parsed.state).toBe('open');
    expect(parsed.sort).toBe('updated');
    expect(parsed.direction).toBe('desc');
  });

  it('truncates an over-long search to the reader limit', () => {
    expect(parseTicketListPresentation(`?searchQuery=${'x'.repeat(300)}`).searchQuery).toHaveLength(200);
  });
});

describe('scope transitions', () => {
  it('moves This MSP to oversight by selecting All workspaces', () => {
    const working: QualifiedTicketListScope = { kind: 'qualified', view: 'working', workspace: 'msp' };
    expect(switchTicketListView(working, 'oversight')).toEqual({
      kind: 'qualified',
      view: 'oversight',
      workspace: 'all',
    });
  });

  it('retains an explicit customer workspace between views', () => {
    const working: QualifiedTicketListScope = { kind: 'qualified', view: 'working', workspace: { tenant: TENANT_A } };
    expect(switchTicketListView(working, 'oversight').workspace).toEqual({ tenant: TENANT_A });
  });

  it('compares scopes structurally', () => {
    expect(ticketListScopesEqual(
      { kind: 'qualified', view: 'working', workspace: { tenant: TENANT_B } },
      { kind: 'qualified', view: 'working', workspace: { tenant: TENANT_B } },
    )).toBe(true);
    expect(ticketListScopesEqual(
      { kind: 'qualified', view: 'working', workspace: 'all' },
      { kind: 'qualified', view: 'oversight', workspace: 'all' },
    )).toBe(false);
    expect(ticketListScopesEqual({ kind: 'native' }, { kind: 'native' })).toBe(true);
  });

  it('keeps workspace tokens stable', () => {
    expect(ticketListWorkspaceToken('all')).toBe('all');
    expect(ticketListWorkspaceToken('msp')).toBe('msp');
    expect(ticketListWorkspaceToken({ tenant: TENANT_A })).toBe(TENANT_A);
  });

  it('resets filters and page but can keep a fixed client', () => {
    const reset = resetQualifiedTicketListPresentation(
      { clientId: TENANT_A, searchQuery: 'x', page: 4, pageSize: 25, state: 'closed', sort: 'title', direction: 'asc' },
      { keepClient: true },
    );
    expect(reset).toMatchObject({ clientId: TENANT_A, searchQuery: '', page: 1, pageSize: 10, state: 'open', sort: 'updated', direction: 'desc' });
  });

  it('type-narrows on qualified scopes', () => {
    expect(isQualifiedTicketListScope(parseTicketListScope('?queueView=working'))).toBe(true);
    expect(isQualifiedTicketListScope(parseTicketListScope(''))).toBe(false);
  });
});
