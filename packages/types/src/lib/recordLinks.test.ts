import { describe, expect, it } from 'vitest';
import {
  RECORD_ENTITY_TYPES,
  isRecordEntityType,
  matchRecordPath,
  recordPath,
  recordUrl,
} from './recordLinks';

const ID = '3f2b8c1e-0a4d-4f6e-9b7a-1c2d3e4f5a6b';
const PROJECT = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';

describe('recordLinks', () => {
  it('maps every record type to its canonical path', () => {
    expect(recordPath('ticket', ID)).toBe(`/msp/tickets/${ID}`);
    expect(recordPath('asset', ID)).toBe(`/msp/assets/${ID}`);
    expect(recordPath('project', ID)).toBe(`/msp/projects/${ID}`);
    expect(recordPath('project_task', ID, { projectId: PROJECT })).toBe(`/msp/projects/${PROJECT}?taskId=${ID}`);
    expect(recordPath('project_task', ID, { projectId: PROJECT, phaseId: 'ph1' })).toBe(
      `/msp/projects/${PROJECT}?taskId=${ID}&phaseId=ph1`
    );
    expect(recordPath('stock_unit', ID)).toBe(`/msp/inventory/units?unitId=${ID}`);
    expect(recordPath('rma', ID)).toBe(`/msp/inventory/rma?rmaId=${ID}`);
    expect(recordPath('staging_container', ID, { projectId: PROJECT })).toBe(`/msp/projects/${PROJECT}/staging?containerId=${ID}`);
  });

  it.each(RECORD_ENTITY_TYPES.map((type) => [type]))('round-trips %s through path and absolute url', (type) => {
    const options = type === 'project_task' || type === 'staging_container' ? { projectId: PROJECT } : {};
    const expected = { entityType: type, id: ID, ...options };
    expect(matchRecordPath(recordPath(type, ID, options))).toEqual(expected);
    expect(matchRecordPath(recordUrl(type, ID, 'https://psa.example.com/', options))).toEqual(expected);
    expect(matchRecordPath(`${recordPath(type, ID, options)}#comment-1`)).toEqual(expected);
  });

  it('round-trips ids that need percent-encoding', () => {
    expect(matchRecordPath(recordPath('ticket', 'a/b c'))).toEqual({ entityType: 'ticket', id: 'a/b c' });
  });

  it('round-trips the optional phase of a project task', () => {
    const path = recordPath('project_task', ID, { projectId: PROJECT, phaseId: 'ph1' });
    expect(matchRecordPath(path)).toEqual({ entityType: 'project_task', id: ID, projectId: PROJECT, phaseId: 'ph1' });
  });

  it('still recognises the legacy project task route', () => {
    expect(matchRecordPath(`/msp/projects/${PROJECT}/tasks/${ID}`)).toEqual({
      entityType: 'project_task',
      id: ID,
      projectId: PROJECT,
    });
  });

  it('builds absolute urls without doubling slashes', () => {
    expect(recordUrl('ticket', ID, 'https://psa.example.com///')).toBe(`https://psa.example.com/msp/tickets/${ID}`);
  });

  it('fails fast on bad input', () => {
    expect(() => recordPath('ticket', '')).toThrow(/non-empty/);
    expect(() => recordPath('project_task', ID)).toThrow(/projectId/);
    expect(() => recordPath('staging_container', ID)).toThrow(/projectId/);
    expect(() => recordUrl('ticket', ID, 'psa.example.com')).toThrow(/absolute http/);
  });

  it('returns null for anything that is not a record link', () => {
    for (const input of [
      '',
      '/',
      '/msp/tickets',
      '/msp/tickets/',
      `/msp/tickets/${ID}/extra`,
      '/msp/inventory/units',
      '/msp/inventory/rma?status=open',
      `/msp/projects/${PROJECT}/staging`,
      `/msp/projects/${PROJECT}/staging/extra?containerId=${ID}`,
      '/msp/clients/abc',
      '/client-portal/tickets/abc',
      `/msp/tickets/%E0%A4%A`,
    ]) {
      expect(matchRecordPath(input)).toBeNull();
    }
  });

  it('narrows entity types', () => {
    expect(isRecordEntityType('rma')).toBe(true);
    expect(isRecordEntityType('invoice')).toBe(false);
  });

  it('carries no secret: output is only the path derived from the id', () => {
    expect(recordUrl('asset', ID, 'https://psa.example.com')).toBe(`https://psa.example.com/msp/assets/${ID}`);
  });
});
