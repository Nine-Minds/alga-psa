import { describe, expect, it } from 'vitest';
import { NATIVE_PROJECT_SCREEN } from '../projectDataSource';
import { nativeProjectDataSource } from '../nativeProjectDataSource';
import {
  OPEN_PROJECT_SURFACE, isProjectSurfaceOpen, projectDataSourceForSurface, projectScreenForSurface, projectScreenOffers,
} from '../projectSurface';

const SEAT = {
  closedFields: ['billing_profile_id', 'budgeted_hours', 'service_id'],
  closedOperations: ['project_billing', 'project_manage', 'project_materials', 'service_catalog'],
};

describe('project surface', () => {
  it('is the native screen, and the native data source object, when nothing is closed', () => {
    expect(isProjectSurfaceOpen(OPEN_PROJECT_SURFACE)).toBe(true);
    expect(projectScreenForSurface(OPEN_PROJECT_SURFACE)).toBe(NATIVE_PROJECT_SCREEN);
    expect(projectDataSourceForSurface(nativeProjectDataSource, OPEN_PROJECT_SURFACE)).toBe(nativeProjectDataSource);
    expect(projectScreenOffers(NATIVE_PROJECT_SCREEN, 'service_catalog')).toBe(true);
  });

  it('narrows the native screen for a seat technician: no service field, no management, status and assignee stay open', () => {
    const screen = projectScreenForSurface(SEAT);
    expect(screen.hiddenFields).toContain('service_id');
    expect(screen.freezeProjectEdit).toBe(true);
    expect(screen.hideCreate).toBe(true);
    expect(screen.hidePhaseMoves).toBe(true);
    expect(screen.admittedTaskEdit).toBe(true);
    expect(screen.readOnly).toBe(false);
    expect(screen.frozenFields).not.toContain('project_status_mapping_id');
    expect(screen.frozenFields).not.toContain('assigned_to');
    expect(screen.frozenFields).toEqual(expect.arrayContaining(['task_name', 'due_date', 'estimated_hours', 'service_id', 'phase_id']));
    for (const operation of SEAT.closedOperations) expect(projectScreenOffers(screen, operation), operation).toBe(false);
    // Dragging a card between status columns is a status update, which a seat technician may do.
    expect(screen.hideKanbanDrag).toBe(false);
  });

  it('keeps the native actions and kind, and builds one data source per surface', () => {
    const source = projectDataSourceForSurface(nativeProjectDataSource, SEAT);
    expect(source).not.toBe(nativeProjectDataSource);
    expect(source.kind).toBe('native');
    expect(source.tasks.updateStatus).toBe(nativeProjectDataSource.tasks.updateStatus);
    expect(projectDataSourceForSurface(nativeProjectDataSource, { ...SEAT, closedFields: [...SEAT.closedFields].reverse() })).toBe(source);
  });
});
