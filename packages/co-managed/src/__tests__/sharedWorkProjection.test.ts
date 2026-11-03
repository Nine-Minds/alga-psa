import { describe, expect, it } from 'vitest';
import { maskCoManagedSnapshot, CO_MANAGED_TASK_NAME_ALIASES, CO_MANAGED_PROJECT_NAME_ALIASES, CO_MANAGED_TASK_RESOURCE_ALIASES, isCoManagedTaskResourceHidden,
  CO_MANAGED_ORGANIZATION_NAME_ALIASES, CO_MANAGED_ORGANIZATION_NAME_FIELD_NAMES, CO_MANAGED_ASSIGNEE_NAME_ALIASES,
  CO_MANAGED_PROJECT_FIELD_SOURCE, CO_MANAGED_PHASE_FIELD_SOURCE, CO_MANAGED_TASK_FIELD_SOURCE } from '../sharedWorkProjection';
import { isCoManagedReadFieldHidden } from '../sharedWorkRedaction';
import { projectCoManagedNotificationSnapshot } from '../sharedWorkProjection';

const row = { taskName: 'Fix', projectName: 'Rollout', revision: 3 };
const spec = { taskName: CO_MANAGED_TASK_NAME_ALIASES, projectName: CO_MANAGED_PROJECT_NAME_ALIASES };

describe('maskCoManagedSnapshot', () => {
  it('returns the row unchanged when nothing is redacted', () => {
    expect(maskCoManagedSnapshot([], row, spec)).toEqual(row);
  });
  it('nulls (does not drop) a hidden field and leaves others intact', () => {
    const masked = maskCoManagedSnapshot(['task_name'], row, spec);
    expect(masked).toEqual({ taskName: null, projectName: 'Rollout', revision: 3 });
    expect(Object.keys(masked)).toEqual(Object.keys(row));
  });
  it('honours alias, nested-prefix and fields. forms', () => {
    expect(maskCoManagedSnapshot(['fields.projects.project_name'], row, spec).projectName).toBeNull();
    expect(maskCoManagedSnapshot(['project_tasks'], row, spec).taskName).toBeNull();
  });
  it('wildcard nulls every spec field but not unspecified ones', () => {
    expect(maskCoManagedSnapshot(['*'], row, spec)).toEqual({ taskName: null, projectName: null, revision: 3 });
  });
  it('does not mutate its input', () => {
    maskCoManagedSnapshot(['*'], row, spec);
    expect(row.taskName).toBe('Fix');
  });
});

describe('projectCoManagedNotificationSnapshot', () => {
  it('masks canonical email and routing fields and suppresses all conversation payload fields', () => {
    const projected = projectCoManagedNotificationSnapshot(
      ['tickets.title', 'ticket_number', 'requester_email', 'assigned_to', 'client_name', 'comments.content'],
      { ticketTitle: 'Sensitive', ticketNumber: 'T-1', requesterEmail: 'person@example.test', assignedToName: 'Agent', clientName: 'Client',
        commentContent: 'private body', commentPreview: 'private preview', commentHtml: '<p>private body</p>', commentRawContent: 'raw' });
    expect(projected).toMatchObject({ ticketTitle: null, ticketNumber: null, requesterEmail: null, assignedToName: null, clientName: null,
      commentContent: null, commentPreview: null, commentHtml: null, commentRawContent: null, conversationSuppressed: true });
  });

  it('keeps allowed fields and conversation content for an unrelated redaction', () => {
    const projected = projectCoManagedNotificationSnapshot(['priority'], { ticketTitle: 'Visible', commentPreview: 'visible comment' });
    expect(projected).toMatchObject({ ticketTitle: 'Visible', commentPreview: 'visible comment', conversationSuppressed: false });
  });

  it('masks persisted comment body aliases, canonical author sources, and derived ticket context', () => {
    const row = { commentContent: 'private', commentPreview: 'private preview', authorName: 'Morgan',
      priority: 'Urgent', status: 'Open', board: 'Service', categoryDetails: 'Hardware / Laptop',
      metaLine: 'Ticket #T-9 · Urgent Priority · Open' };
    expect(projectCoManagedNotificationSnapshot(['note'], row).commentContent).toBeNull();
    expect(projectCoManagedNotificationSnapshot(['markdown_content'], row).commentPreview).toBeNull();
    expect(projectCoManagedNotificationSnapshot(['actor_display_name'], row).authorName).toBeNull();
    expect(projectCoManagedNotificationSnapshot(['contact_id'], { authorName: 'Morgan' }).authorName).toBeNull();
    expect(projectCoManagedNotificationSnapshot(['priority_id'], row)).toMatchObject({ priority: null, metaLine: null });
    expect(projectCoManagedNotificationSnapshot(['ticket_number'], row).metaLine).toBeNull();
    expect(projectCoManagedNotificationSnapshot(['requester_name'], { requesterDetails: 'Name · email' }).requesterDetails).toBeNull();
    expect(projectCoManagedNotificationSnapshot(['assignee_name'], { assignedDetails: 'Name (email)' }).assignedDetails).toBeNull();
    expect(projectCoManagedNotificationSnapshot(['subcategory_name'], { categoryDetails: 'Category / Subcategory', subcategory: 'Subcategory' }))
      .toMatchObject({ categoryDetails: null, subcategory: null });
    expect(projectCoManagedNotificationSnapshot(['*'], row)).toMatchObject({ priority: null, status: null, board: null, categoryDetails: null, metaLine: null });
  });
});

describe('isCoManagedTaskResourceHidden', () => {
  it('is true for the whole-resource aliases', () => {
    expect(isCoManagedTaskResourceHidden(['tasks'])).toBe(true);
    expect(isCoManagedTaskResourceHidden(['project_tasks'])).toBe(true);
  });
  it('is true for the global and fields-prefixed whole-resource entries', () => {
    for (const f of ['*', 'fields', 'fields.tasks', 'fields.project_tasks']) expect(isCoManagedTaskResourceHidden([f])).toBe(true);
  });
  it('is false for nested per-field paths', () => {
    for (const f of ['project_tasks.task_name', 'tasks.description', 'fields.tasks.task_id']) expect(isCoManagedTaskResourceHidden([f])).toBe(false);
  });
  it('is false for a single field or no redactions', () => {
    expect(isCoManagedTaskResourceHidden(['task_name'])).toBe(false);
    expect(isCoManagedTaskResourceHidden([])).toBe(false);
  });
  it('is built into the task-name aliases from one definition', () => {
    for (const alias of CO_MANAGED_TASK_RESOURCE_ALIASES) expect(CO_MANAGED_TASK_NAME_ALIASES).toContain(alias);
  });
});

describe('organization-name aliases', () => {
  // Every spelling the organization name is stored or projected under; a redaction by any of them must hide it.
  it.each(['organizationName', 'organization_name', 'client_name', 'tenants', 'values.organization_name'])('hides the name when %s is redacted', spelling => {
    expect(isCoManagedReadFieldHidden([spelling], CO_MANAGED_ORGANIZATION_NAME_ALIASES)).toBe(true);
    expect(isCoManagedReadFieldHidden([`fields.${spelling}`], CO_MANAGED_ORGANIZATION_NAME_ALIASES)).toBe(true);
  });
  it('is the canonical field-name list, so the cached mask and the live read share one set', () => {
    expect(CO_MANAGED_ORGANIZATION_NAME_ALIASES).toBe(CO_MANAGED_ORGANIZATION_NAME_FIELD_NAMES);
  });
  it('is not hidden by unrelated redactions', () => {
    expect(isCoManagedReadFieldHidden(['task_name', 'project_name', 'assignee_name'], CO_MANAGED_ORGANIZATION_NAME_ALIASES)).toBe(false);
  });
});

describe('alias set consistency', () => {
  // A new field source is added here (one row) and is checked without further work.
  const sources = [
    ['project', CO_MANAGED_PROJECT_FIELD_SOURCE, 'project_name'],
    ['phase', CO_MANAGED_PHASE_FIELD_SOURCE, 'phase_name'],
    ['task', CO_MANAGED_TASK_FIELD_SOURCE, 'task_name'],
  ] as const;
  it.each(sources)('the %s title set carries both the plain and the values.-prefixed spelling', (_kind, source, base) => {
    expect(source.title).toContain(base);
    expect(source.title).toContain(`values.${base}`);
  });
  it.each([['organization', CO_MANAGED_ORGANIZATION_NAME_ALIASES, 'organization_name'], ['assignee', CO_MANAGED_ASSIGNEE_NAME_ALIASES, 'assignee_name']] as const)(
    'the %s name set carries both the plain and the values.-prefixed spelling', (_kind, aliases, base) => {
      expect(aliases).toContain(base);
      expect(aliases).toContain(`values.${base}`);
    });
});
